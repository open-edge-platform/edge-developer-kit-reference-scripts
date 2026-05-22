// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import jsonata from 'jsonata'
import type { BasePayload } from 'payload'
import { getServicesPortMap } from '@/services/config-registry'
import type { Service } from '../payload-types'
import { logger } from './logger'
import { listProcesses, removeDeadProcess } from './process-handler'

const HEALTHCHECK_TIMEOUT = 3000
const HEALTHCHECK_INTERVAL = 10000
const DEFAULT_STARTUP_TIMEOUT = 600 // seconds (10 minutes)
const WORKLOAD_COLLECTION = 'services'

enum ServiceStatus {
  PREPARE = 'prepare',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  RESTART = 'restart',
  ERROR = 'error',
}

enum ProcessStatus {
  ACTIVE = 'active',
  STOPPED = 'stopped',
  ERROR = 'error',
}

interface RetryConfig {
  maxRetries: number
  initialDelay: number
  backoffFactor: number
  maxDelay: number
}

interface ServiceUpdateData {
  status?: Service['status']
  isHealthy?: boolean
}

interface ProcessInfo {
  name: string
  pid: number | undefined
  status: string
  startTime: Date
}

type StatusResult = {
  newStatus: Service['status'] | null
  newIsHealthy: boolean | null
}

const HEALTHCHECK_RETRY_CONFIG: RetryConfig = {
  maxRetries: 6,
  initialDelay: 1000,
  backoffFactor: 2,
  maxDelay: 64000,
}

const PREPARE_STATUS_RETRY_CONFIG: RetryConfig = {
  maxRetries: 10,
  initialDelay: 1000,
  backoffFactor: 1.5,
  maxDelay: 3000,
}

declare global {
  var serviceHealthCheckInterval: NodeJS.Timeout | undefined
}

const checkingServices = new Set<string | number>()

// Returns sanitized alphanumeric string or null
const sanitizeString = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const sanitized = String(value).trim()
  return /^[a-zA-Z0-9\-_]+$/.test(sanitized) ? sanitized : null
}

// Validates a relative health URL path, returns sanitized path or null (SSRF / path traversal protection)
const validateHealthUrl = (healthUrl: string): string | null => {
  if (typeof healthUrl !== 'string' || !healthUrl.trim()) {
    logger.log(`Invalid health URL: ${healthUrl}`)
    return null
  }

  const sanitized = healthUrl.trim()

  if (sanitized.includes('..') || sanitized.includes('\\')) {
    logger.log(`Path traversal attempt detected: ${sanitized}`)
    return null
  }

  if (
    sanitized.includes('://') ||
    sanitized.includes('//') ||
    sanitized.match(/^[a-z]+:/i)
  ) {
    logger.log(`Absolute URL or protocol detected: ${sanitized}`)
    return null
  }

  if (!sanitized.startsWith('/')) {
    logger.log(
      `Health URL must be a relative path starting with '/': ${sanitized}`,
    )
    return null
  }

  return sanitized
}

// Checks if a PID exists on the system via signal 0
const isPidAlive = (pid: number | undefined): boolean => {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error) {
      return error.code === 'EPERM'
    }
    return false
  }
}

// Removes a dead process from the tracker and logs it
const cleanupDeadProcess = (processName: string): void => {
  removeDeadProcess(processName)
  logger.log(`Removed dead process ${processName} from process list`)
}

// Extracts a human-readable error message
const getErrorMessage = (error: unknown): string => {
  if (error && typeof error === 'object') {
    if ('code' in error && typeof error.code === 'string')
      return `Error code: ${error.code}`
    if ('message' in error && typeof error.message === 'string')
      return error.message
    if ('status' in error && typeof error.status === 'number')
      return `HTTP ${error.status}`
  }
  return String(error)
}

// Retries an async operation with exponential backoff
const retryWithBackoff = async <T>(
  operation: () => Promise<T>,
  retryConfig = HEALTHCHECK_RETRY_CONFIG,
): Promise<T> => {
  let lastError: unknown

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt < retryConfig.maxRetries) {
        const delay = Math.min(
          retryConfig.initialDelay * retryConfig.backoffFactor ** attempt,
          retryConfig.maxDelay,
        )
        logger.log(
          `Health check attempt ${attempt + 1} failed, retrying in ${delay}ms: ${getErrorMessage(error)}`,
        )
        await new Promise((resolve) => {
          setTimeout(() => resolve(1), delay)
        })
      }
    }
  }

  throw lastError
}

// Validates the health check response body using JSONata-based response mapper
const validateHealthCheckResponse = async (
  response: Response,
  service: Service,
): Promise<boolean> => {
  if (!service.healthCheck?.responseMapper) return true

  const mapper = service.healthCheck.responseMapper as Record<string, string>

  try {
    const responseBody = await response.json()
    logger.log(
      `Health check response for service ${service.id}: ${JSON.stringify(responseBody)}`,
    )

    for (const [servicePath, expression] of Object.entries(mapper)) {
      if (!expression || typeof expression !== 'string') continue

      let actualValue: unknown
      try {
        actualValue = await jsonata(expression).evaluate(responseBody, {
          service,
        })
      } catch (err) {
        logger.log(`JSONata error for ${expression}: ${err}`)
        return false
      }

      const expectedValue = await jsonata(servicePath).evaluate(service)
      if (!expectedValue) {
        logger.log(
          `Expected value for ${servicePath} is undefined, skipping validation.`,
        )
        continue
      }

      if (
        actualValue === undefined ||
        String(actualValue) !== String(expectedValue)
      ) {
        logger.log(
          `Validation failed for ${servicePath}. Expected: ${expectedValue}, Got: ${actualValue}`,
        )
        return false
      }
    }

    return true
  } catch (error) {
    logger.log(
      `Error validating response for service ${service.id}: ${getErrorMessage(error)}`,
    )
    return false
  }
}

// Fetches a health endpoint with timeout and validates the response
const fetchHealthEndpoint = async (
  url: string,
  service: Service,
): Promise<boolean> => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), HEALTHCHECK_TIMEOUT)

  try {
    const sanitizedURL = new URL(url)
    const response = await fetch(sanitizedURL, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (response.status !== 200) {
      throw new Error(`Health check returned status ${response.status}`)
    }

    return await validateHealthCheckResponse(response, service)
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

// Builds a localhost health check URL from port and relative path
const buildHealthCheckUrl = (port: number, healthUrl: string) => {
  const allowedPorts = Object.values(getServicesPortMap())
  if (!port || !allowedPorts.includes(port)) {
    logger.log(
      `Invalid or disallowed port: ${port}. Allowed ports: ${allowedPorts.join(', ')}`,
    )
    return null
  }

  const sanitized = validateHealthUrl(healthUrl)
  if (!sanitized) return null

  const cleanPath = sanitized.replace(/^\/+/, '')
  return new URL(cleanPath, `http://localhost:${port}`).toString()
}

// Performs a health check with retries against a service's configured endpoint
const performHealthCheck = async (
  service: Service,
  port: number,
  retryConfig: RetryConfig = HEALTHCHECK_RETRY_CONFIG,
): Promise<boolean> => {
  if (!service.healthCheck?.url) {
    logger.log(
      `No health check URL configured for service ${service.id}, skipping`,
    )
    return true
  }

  const url = buildHealthCheckUrl(port, service.healthCheck.url)
  if (!url) throw new Error('Invalid health check URL or port')

  try {
    return await retryWithBackoff(
      () => fetchHealthEndpoint(url, service),
      retryConfig,
    )
  } catch (error: unknown) {
    const configType =
      retryConfig === PREPARE_STATUS_RETRY_CONFIG ? 'Prepare status ' : ''
    logger.log(
      `${configType}healthcheck failed after all retries for service ${service.id} (${service.name}): ${getErrorMessage(error)}`,
    )
    return false
  }
}

// Updates a service record in the database
const updateServiceInDatabase = async (
  payload: BasePayload,
  serviceId: number | string,
  data: ServiceUpdateData,
): Promise<void> => {
  try {
    await payload.update({
      collection: WORKLOAD_COLLECTION,
      id: serviceId,
      data,
    })

    const statusInfo = data.status ? ` status to ${data.status}` : ''
    const healthInfo =
      data.isHealthy !== undefined ? ` (isHealthy: ${data.isHealthy})` : ''
    logger.log(`Updated service ${serviceId}${statusInfo}${healthInfo}`)
  } catch (error) {
    logger.error(`Failed to update service ${serviceId}:`, error)
  }
}

// Determines status for a custom (standalone worker) service based on its process state
const determineCustomServiceStatus = async (
  service: Service,
  process: ProcessInfo | undefined,
  processName: string,
): Promise<StatusResult> => {
  const { id, healthCheck, port, status } = service

  if (!process) {
    logger.log(`Process for ${id} not found. Marking as error.`)
    return { newStatus: ServiceStatus.ERROR, newIsHealthy: false }
  }

  if (!isPidAlive(process.pid)) {
    logger.log(
      `Process ${id} (PID: ${process.pid}) no longer exists. Marking as error.`,
    )
    cleanupDeadProcess(processName)
    return { newStatus: ServiceStatus.ERROR, newIsHealthy: false }
  }

  switch (process.status) {
    case ProcessStatus.ACTIVE:
      if (healthCheck?.url && port) {
        const healthy = await performHealthCheck(service, port)
        // Keep process running even if unhealthy — only update health flag
        return {
          newStatus:
            healthy && status !== ServiceStatus.ACTIVE
              ? ServiceStatus.ACTIVE
              : null,
          newIsHealthy: healthy,
        }
      }
      if (!healthCheck?.url && status !== ServiceStatus.ACTIVE) {
        return { newStatus: ServiceStatus.ACTIVE, newIsHealthy: true }
      }
      return { newStatus: null, newIsHealthy: null }

    case ProcessStatus.STOPPED:
      return { newStatus: ServiceStatus.INACTIVE, newIsHealthy: false }

    case ProcessStatus.ERROR:
      return { newStatus: ServiceStatus.ERROR, newIsHealthy: false }

    default:
      return { newStatus: null, newIsHealthy: null }
  }
}

// Determines status for a multiserve service based solely on health checks
const determineMultiserveServiceStatus = async (
  service: Service,
): Promise<StatusResult> => {
  const { id, healthCheck, port, status } = service

  if (!healthCheck?.url || !port) {
    logger.log(`Multiserve service ${id} missing healthcheck url or port`)
    return { newStatus: null, newIsHealthy: null }
  }

  const healthy = await performHealthCheck(service, port)
  return {
    newStatus:
      healthy && status !== ServiceStatus.ACTIVE ? ServiceStatus.ACTIVE : null,
    newIsHealthy: healthy,
  }
}

// Routes status determination to the correct handler based on engine type
const determineServiceStatus = async (
  service: Service,
  process: ProcessInfo | undefined,
  processName: string,
): Promise<StatusResult> => {
  if (service.engine === 'worker') {
    return determineCustomServiceStatus(service, process, processName)
  }
  return determineMultiserveServiceStatus(service)
}

// Handles services in "prepare" status with aggressive health check retries
const handlePrepareStatus = async (
  service: Service,
  process: ProcessInfo,
): Promise<StatusResult> => {
  const { id, healthCheck, port } = service

  if (!isPidAlive(process.pid)) {
    return { newStatus: null, newIsHealthy: null }
  }

  if (healthCheck?.url && port) {
    logger.log(
      `Service ${id} in prepare status, performing aggressive health check...`,
    )
    const healthy = await performHealthCheck(
      service,
      port,
      PREPARE_STATUS_RETRY_CONFIG,
    )

    if (healthy) {
      logger.log(`Service ${id} healthy, transitioning prepare → active`)
      return { newStatus: ServiceStatus.ACTIVE, newIsHealthy: true }
    }

    logger.log(`Service ${id} still preparing, will retry next interval`)
    return { newStatus: null, newIsHealthy: false }
  }

  if (process.status === ProcessStatus.ACTIVE) {
    logger.log(`Service ${id} process active, transitioning prepare → active`)
    return { newStatus: ServiceStatus.ACTIVE, newIsHealthy: true }
  }

  return { newStatus: null, newIsHealthy: null }
}

// Processes a single service: cleans up dead services, checks prepare state, and determines health
const processServiceHealthCheck = async (
  payload: BasePayload,
  service: Service,
  process: ProcessInfo | undefined,
  processName: string,
  startupTimeoutSeconds: number,
): Promise<void> => {
  const status = service.status as Service['status']
  const currentIsHealthy = service.isHealthy || false

  // Inactive/error services: clean up dead processes and ensure unhealthy state
  if (status === ServiceStatus.INACTIVE || status === ServiceStatus.ERROR) {
    if (process && !isPidAlive(process.pid)) {
      cleanupDeadProcess(processName)
    }
    if (currentIsHealthy) {
      await updateServiceInDatabase(payload, service.id, { isHealthy: false })
    }
    return
  }

  // Check startup timeout using Payload's updatedAt timestamp
  if (status === ServiceStatus.PREPARE) {
    const updatedAt = new Date(service.updatedAt).getTime()
    const elapsed = Date.now() - updatedAt
    const timeoutMs = startupTimeoutSeconds * 1000

    if (elapsed >= timeoutMs) {
      logger.log(
        `Service ${service.id} (${service.name}) exceeded startup timeout of ${startupTimeoutSeconds}s. Marking as error.`,
      )
      await updateServiceInDatabase(payload, service.id, {
        status: ServiceStatus.ERROR,
        isHealthy: false,
      })
      return
    }
  }

  let result: StatusResult = { newStatus: null, newIsHealthy: null }

  if (status === ServiceStatus.PREPARE && process) {
    if (
      process.status === ProcessStatus.ERROR ||
      process.status === ProcessStatus.STOPPED
    ) {
      result = { newStatus: ServiceStatus.ERROR, newIsHealthy: false }
    } else if (isPidAlive(process.pid)) {
      result = await handlePrepareStatus(service, process)
    }
  } else {
    result = await determineServiceStatus(service, process, processName)
  }

  // Apply changes only if status or health actually changed
  const needsStatusUpdate =
    result.newStatus !== null && result.newStatus !== status
  const needsHealthUpdate =
    result.newIsHealthy !== null && result.newIsHealthy !== currentIsHealthy

  if (needsStatusUpdate || needsHealthUpdate) {
    const updateData: ServiceUpdateData = {}
    if (needsStatusUpdate && result.newStatus !== null)
      updateData.status = result.newStatus
    if (needsHealthUpdate && result.newIsHealthy !== null)
      updateData.isHealthy = result.newIsHealthy
    await updateServiceInDatabase(payload, service.id, updateData)
  }
}

// Runs health checks for all services in parallel
const processHealthChecks = async (payload: BasePayload): Promise<void> => {
  try {
    const [services, appSettings] = await Promise.all([
      payload.find({
        collection: WORKLOAD_COLLECTION,
        pagination: false,
      }),
      payload.findGlobal({
        slug: 'app-settings',
        overrideAccess: true,
      }),
    ])

    const startupTimeoutSeconds =
      appSettings.startupTimeout ?? DEFAULT_STARTUP_TIMEOUT
    const processes = listProcesses()

    await Promise.all(
      services.docs.map(async (service) => {
        const { id, type, engine } = service

        if (checkingServices.has(id)) return
        checkingServices.add(id)

        try {
          const sanitizedType = sanitizeString(type)
          const sanitizedEngine = sanitizeString(engine)

          if (!sanitizedType || !sanitizedEngine) {
            logger.log(`Invalid service type or engine for service ${id}`)
            return
          }

          const processName = `${sanitizedType}`
          const process = processes.find((p) => p.name === processName)

          await processServiceHealthCheck(
            payload,
            service as Service,
            process,
            processName,
            startupTimeoutSeconds,
          )
        } catch (error) {
          logger.error(
            `Error processing health check for service ${id}:`,
            error,
          )
        } finally {
          checkingServices.delete(id)
        }
      }),
    )
  } catch (err) {
    logger.error('Health check failed:', err)
  }
}

// Starts periodic health check polling
export const initHealthCheckService = (payload: BasePayload): void => {
  if (globalThis.serviceHealthCheckInterval) {
    clearInterval(globalThis.serviceHealthCheckInterval)
  }

  logger.log('Starting service health check service with 10 second interval')

  globalThis.serviceHealthCheckInterval = setInterval(() => {
    processHealthChecks(payload).catch((error) => {
      logger.error('Health check service error:', error)
    })
  }, HEALTHCHECK_INTERVAL)

  processHealthChecks(payload).catch((error) => {
    logger.error('Initial health check error:', error)
  })
}

// Stops periodic health check polling
export const stopHealthCheckService = (): void => {
  if (globalThis.serviceHealthCheckInterval) {
    clearInterval(globalThis.serviceHealthCheckInterval)
    globalThis.serviceHealthCheckInterval = undefined
    logger.log('Stopped service health check service')
  }
}

export { retryWithBackoff, isPidAlive, validateHealthUrl, sanitizeString }

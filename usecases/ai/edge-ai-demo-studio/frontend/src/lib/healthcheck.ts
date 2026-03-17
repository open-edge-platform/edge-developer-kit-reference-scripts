// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ALLOWED_PORTS } from '@/lib/constants'
import { listProcesses, removeDeadProcess } from '@/lib/process-handler'
import { Workload } from '@/payload-types'
import { logger } from '@/utils/logger'
import { BasePayload } from 'payload'
import jsonata from 'jsonata'

// Constants
const HEALTHCHECK_TIMEOUT = 3000 // ms
const HEALTHCHECK_INTERVAL = 10000 // 10 seconds
const WORKLOAD_COLLECTION = 'workloads'

// Enums for better type safety
enum WorkloadStatus {
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

// Types and Interfaces
interface RetryConfig {
  maxRetries: number
  initialDelay: number
  backoffFactor: number
  maxDelay: number
}

interface WorkloadUpdateData {
  status?: Workload['status']
  isHealthy?: boolean
}

interface UrlValidationResult {
  isValid: boolean
  sanitized?: string
  error?: string
}

interface ProcessInfo {
  name: string
  pid: number | undefined
  status: string
  startTime: Date
}

// Retry configurations
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

// Global health check interval reference
declare global {
  var workloadHealthCheckInterval: NodeJS.Timeout | undefined
}

// Track currently checking workloads to prevent overlap
const checkingWorkloads = new Set<string | number>()

/**
 * Sanitizes a string value to ensure it contains only safe characters
 */
const sanitizeString = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null
  }

  const sanitized = String(value).trim()
  const validPattern = /^[a-zA-Z0-9\-_]+$/

  return validPattern.test(sanitized) ? sanitized : null
}

/**
 * Validates a health URL for security vulnerabilities
 */
const validateHealthUrl = (healthUrl: string): UrlValidationResult => {
  if (typeof healthUrl !== 'string' || !healthUrl.trim()) {
    return {
      isValid: false,
      error: `Invalid health URL: ${healthUrl}`,
    }
  }

  const sanitized = healthUrl.trim()

  // Check for path traversal attempts
  if (sanitized.includes('..') || sanitized.includes('\\')) {
    return {
      isValid: false,
      error: `Path traversal attempt detected: ${sanitized}`,
    }
  }

  // Check for absolute URLs or protocol schemes (SSRF protection)
  if (
    sanitized.includes('://') ||
    sanitized.includes('//') ||
    sanitized.match(/^[a-z]+:/i)
  ) {
    return {
      isValid: false,
      error: `Absolute URL or protocol detected: ${sanitized}`,
    }
  }

  // Ensure relative path starting with '/'
  if (!sanitized.startsWith('/')) {
    return {
      isValid: false,
      error: `Health URL must be a relative path starting with '/': ${sanitized}`,
    }
  }

  return { isValid: true, sanitized }
}

/**
 * Checks if a PID actually exists on the system
 */
const isPidAlive = (pid: number | undefined): boolean => {
  if (!pid || pid <= 0) {
    return false
  }

  try {
    // Sending signal 0 checks if process exists without affecting it
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    // ESRCH: process doesn't exist, EPERM: process exists but no permission
    if (error && typeof error === 'object' && 'code' in error) {
      return error.code === 'EPERM'
    }
    return false
  }
}

/**
 * Extracts a concise error message from request errors
 */
const getErrorMessage = (error: unknown): string => {
  if (error && typeof error === 'object') {
    // Handle fetch errors and HTTP errors
    if ('code' in error && typeof error.code === 'string') {
      return `Error code: ${error.code}`
    }
    if ('message' in error && typeof error.message === 'string') {
      return error.message
    }
    if ('status' in error && typeof error.status === 'number') {
      return `HTTP ${error.status}`
    }
  }
  return String(error)
}

/**
 * Retry function with exponential backoff
 */
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
          retryConfig.initialDelay *
            Math.pow(retryConfig.backoffFactor, attempt),
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

/**
 * Validates health check response content based on configuration
 */
const validateHealthCheckResponse = async (
  response: Response,
  workload: Workload,
): Promise<boolean> => {
  if (!workload.healthCheck) return true

  // Default to simple check if mapper is missing
  if (!workload.healthCheck.responseMapper) {
    return true
  }

  const mapper = workload.healthCheck.responseMapper as Record<string, string>

  try {
    const responseBody = await response.json()

    for (const [workloadPath, expression] of Object.entries(mapper)) {
      if (!expression || typeof expression !== 'string') continue

      let actualValue
      try {
        const expr = jsonata(expression)
        // Pass workload as variable binding '$workload' to the expression
        actualValue = await expr.evaluate(responseBody, { workload })
      } catch (err) {
        logger.log(`JSONata error for ${expression}: ${err}`)
        return false
      }

      const expectedValue = await jsonata(workloadPath).evaluate(workload)
      if (!expectedValue) {
        logger.log(
          `Expected value for ${workloadPath} is undefined, skipping validation.`,
        )
        continue
      }

      if (
        actualValue === undefined ||
        String(actualValue) !== String(expectedValue)
      ) {
        logger.log(
          `Validation failed for ${workloadPath}. Expected: ${expectedValue}, Got: ${actualValue}`,
        )
        return false
      }
    }

    return true
  } catch (error) {
    logger.log(
      `Error validating response for workload ${workload.id}: ${getErrorMessage(error)}`,
    )
    return false
  }
}

/**
 * Creates an HTTP client for health checks with timeout
 */
const createHealthCheckClient = async (
  url: string,
  workload: Workload,
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

    // Validate response content based on health check configuration
    return await validateHealthCheckResponse(response, workload)
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

/**
 * Validates port and constructs health check URL
 */
const buildHealthCheckUrl = (port: number, healthUrl: string) => {
  if (!port || !ALLOWED_PORTS.includes(port)) {
    logger.log(
      `Invalid or disallowed port: ${port}. Allowed ports: ${ALLOWED_PORTS.join(', ')}`,
    )
    return null
  }

  const validation = validateHealthUrl(healthUrl)
  if (!validation.isValid || !validation.sanitized) {
    if (validation.error) {
      logger.log(validation.error)
    }
    return null
  }

  const baseUrl = `http://localhost:${port}`
  const cleanPath = validation.sanitized.replace(/^\/+/, '')
  return new URL(cleanPath, baseUrl).toString()
}

/**
 * Performs a health check with configurable retry logic and content validation
 */
const performHealthCheck = async (
  workload: Workload,
  port: number,
  retryConfig: RetryConfig = HEALTHCHECK_RETRY_CONFIG,
): Promise<boolean> => {
  if (!workload.healthCheck || !workload.healthCheck.url) {
    logger.log(
      `No health check URL configured for workload ${workload.id}, Skipping healthcheck`,
    )
    return true
  }
  const url = buildHealthCheckUrl(port, workload.healthCheck?.url)
  if (!url) {
    throw new Error('Invalid health check URL or port')
  }

  try {
    const result = await retryWithBackoff(async () => {
      return await createHealthCheckClient(url, workload)
    }, retryConfig)

    return result
  } catch (error: unknown) {
    const configType =
      retryConfig === PREPARE_STATUS_RETRY_CONFIG ? 'Prepare status ' : ''
    logger.log(
      `${configType}healthcheck failed after all retries for workload ${workload.id} (${workload.name}): ${getErrorMessage(error)}`,
    )
    return false
  }
}

/**
 * Database update utility function
 */
const updateWorkloadInDatabase = async (
  payload: BasePayload,
  workloadId: number | string,
  data: WorkloadUpdateData,
): Promise<void> => {
  try {
    await payload.update({
      collection: WORKLOAD_COLLECTION,
      id: workloadId,
      data,
    })

    const statusInfo = data.status ? ` status to ${data.status}` : ''
    const healthInfo =
      data.isHealthy !== undefined ? ` (isHealthy: ${data.isHealthy})` : ''
    logger.log(`Updated workload ${workloadId}${statusInfo}${healthInfo}`)
  } catch (error) {
    logger.error(`Failed to update workload ${workloadId}:`, error)
  }
}

/**
 * Handles cleanup for inactive or error workloads
 */
const handleInactiveWorkloadCleanup = async (
  payload: BasePayload,
  workload: Workload,
  process: ProcessInfo | undefined,
  processName: string,
): Promise<void> => {
  const { id } = workload
  const currentIsHealthy = workload.isHealthy || false

  // Remove dead process from process handler list
  if (process) {
    removeDeadProcess(processName)
    logger.log(
      `Removed dead process ${processName} from process list for workload ${id}`,
    )
  }

  // Set isHealthy to false for dead/inactive workloads
  if (currentIsHealthy) {
    await updateWorkloadInDatabase(payload, workload.id, { isHealthy: false })
  }
}

/**
 * Determines new status based on process state and health checks
 */
const determineCustomWorkloadStatus = async (
  workload: Workload,
  process: ProcessInfo | undefined,
  processName: string,
) => {
  const { id, healthCheck, port, status } = workload
  let newStatus: Workload['status'] | null = null
  let newIsHealthy: boolean | null = null

  if (!process) {
    logger.log(`Process for ${id} not found in process list. Marking as error.`)
    return { newStatus: WorkloadStatus.ERROR, newIsHealthy: false }
  }

  const processStatus = process.status
  const processId = process.pid

  // Validate PID exists on system
  if (!isPidAlive(processId)) {
    logger.log(
      `Process ${id} (PID: ${processId}) no longer exists on system. Marking as error.`,
    )
    removeDeadProcess(processName)
    logger.log(`Removed dead process ${processName} from process list`)
    return { newStatus: WorkloadStatus.ERROR, newIsHealthy: false }
  }

  // Handle different process statuses
  switch (processStatus) {
    case ProcessStatus.ACTIVE:
      if (healthCheck && healthCheck.url && port) {
        const healthy = await performHealthCheck(workload, port)
        newIsHealthy = healthy
        if (healthy && status !== WorkloadStatus.ACTIVE) {
          newStatus = WorkloadStatus.ACTIVE
        }
        // Don't change status to ERROR when health check fails - just mark as unhealthy
        // The process is still running, so keep it as ACTIVE but unhealthy
      } else if (
        !(healthCheck && healthCheck.url) &&
        status !== WorkloadStatus.ACTIVE
      ) {
        newStatus = WorkloadStatus.ACTIVE
        newIsHealthy = true
      }
      break

    case ProcessStatus.STOPPED:
      newStatus = WorkloadStatus.INACTIVE
      newIsHealthy = false
      break

    case ProcessStatus.ERROR:
      newStatus = WorkloadStatus.ERROR
      newIsHealthy = false
      break
  }

  return { newStatus, newIsHealthy }
}

const determineMultiserveWorkloadStatus = async (
  workload: Workload,
): Promise<{
  newStatus: Workload['status'] | null
  newIsHealthy: boolean | null
}> => {
  // For multiserve workloads, we rely solely on health checks
  const { id, healthCheck, port, status } = workload
  let newStatus: Workload['status'] | null = null
  let newIsHealthy: boolean | null = null

  if (healthCheck && healthCheck.url && port) {
    const healthy = await performHealthCheck(workload, port)
    newIsHealthy = healthy
    if (healthy && status !== WorkloadStatus.ACTIVE) {
      newStatus = WorkloadStatus.ACTIVE
    } else if (!healthy && status === WorkloadStatus.ACTIVE) {
      // If previously active but now unhealthy, keep status but mark unhealthy
      newIsHealthy = false
    }
  } else {
    logger.log(
      `Multiserve workload ${id} missing healthcheck url or port for health check`,
    )
  }

  return { newStatus, newIsHealthy }
}

const determineWorkloadStatus = async (
  workload: Workload,
  process: ProcessInfo | undefined,
  processName: string,
): Promise<{
  newStatus: Workload['status'] | null
  newIsHealthy: boolean | null
}> => {
  if (workload.engine === 'custom') {
    return await determineCustomWorkloadStatus(workload, process, processName)
  } else {
    return await determineMultiserveWorkloadStatus(workload)
  }
}

/**
 * Handles special case for workloads in prepare status
 */
const handlePrepareStatus = async (
  workload: Workload,
  process: ProcessInfo | undefined,
): Promise<{
  newStatus: Workload['status'] | null
  newIsHealthy: boolean | null
}> => {
  const { id, healthCheck, port } = workload

  if (!process || !isPidAlive(process.pid)) {
    return { newStatus: null, newIsHealthy: null }
  }

  if (healthCheck && healthCheck.url && port) {
    logger.log(
      `Workload ${id} is in prepare status, performing aggressive health check...`,
    )
    const healthy = await performHealthCheck(
      workload,
      port,
      PREPARE_STATUS_RETRY_CONFIG,
    )

    if (healthy) {
      logger.log(
        `Workload ${id} is now healthy, transitioning from prepare to active`,
      )
      return { newStatus: WorkloadStatus.ACTIVE, newIsHealthy: true }
    } else {
      logger.log(
        `Workload ${id} is still preparing, will check again next interval`,
      )
      // Keep the workload in prepare status but update health status
      return { newStatus: null, newIsHealthy: healthy }
    }
  } else if (process.status === ProcessStatus.ACTIVE) {
    logger.log(
      `Workload ${id} process is active, transitioning from prepare to active`,
    )
    return { newStatus: WorkloadStatus.ACTIVE, newIsHealthy: true }
  }

  return { newStatus: null, newIsHealthy: null }
}

/**
 * Processes health checks for a single workload
 */
const processWorkloadHealthCheck = async (
  payload: BasePayload,
  workload: Workload,
  process: ProcessInfo | undefined,
  processName: string,
): Promise<void> => {
  const status = workload.status as Workload['status']
  const currentIsHealthy = workload.isHealthy || false

  // Handle cleanup for error/inactive workloads that no longer have processes
  if (
    (status === WorkloadStatus.ERROR || status === WorkloadStatus.INACTIVE) &&
    (!process || !isPidAlive(process?.pid))
  ) {
    await handleInactiveWorkloadCleanup(payload, workload, process, processName)
    return
  }

  if (status === WorkloadStatus.INACTIVE || status === WorkloadStatus.ERROR) {
    // If the workload is inactive or error, ensure isHealthy is false
    if (currentIsHealthy) {
      await updateWorkloadInDatabase(payload, workload.id, { isHealthy: false })
    }
    return
  }

  let newStatus: Workload['status'] | null = null
  let newIsHealthy: boolean | null = null

  // Special handling for 'prepare' status
  if (status === WorkloadStatus.PREPARE && process) {
    if (
      process.status === ProcessStatus.ERROR ||
      process.status === ProcessStatus.STOPPED
    ) {
      newStatus = WorkloadStatus.ERROR
      newIsHealthy = false
    } else if (isPidAlive(process.pid)) {
      const prepareResult = await handlePrepareStatus(workload, process)
      newStatus = prepareResult.newStatus
      newIsHealthy = prepareResult.newIsHealthy
    }
  } else {
    // Handle normal status determination
    const statusResult = await determineWorkloadStatus(
      workload,
      process,
      processName,
    )
    newStatus = statusResult.newStatus
    newIsHealthy = statusResult.newIsHealthy
  }

  // Update workload in database if needed
  const needsStatusUpdate = newStatus && newStatus !== status
  const needsHealthUpdate =
    newIsHealthy !== null && newIsHealthy !== currentIsHealthy

  if (needsStatusUpdate || needsHealthUpdate) {
    const updateData: WorkloadUpdateData = {}
    if (needsStatusUpdate) updateData.status = newStatus!
    if (needsHealthUpdate) updateData.isHealthy = newIsHealthy!

    await updateWorkloadInDatabase(payload, workload.id, updateData)
  }
}

/**
 * Background health check processing function
 */
const processHealthChecks = async (payload: BasePayload): Promise<void> => {
  try {
    // Get all workloads for health checks
    const workloads = await payload.find({
      collection: WORKLOAD_COLLECTION,
      pagination: false,
    })

    const processes = listProcesses()

    // Process each workload health check in parallel
    await Promise.all(
      workloads.docs.map(async (workload) => {
        const { id, type, engine } = workload

        // Skip if this workload is already being checked
        if (checkingWorkloads.has(id)) {
          return
        }

        checkingWorkloads.add(id)

        try {
          // Sanitize inputs
          const sanitizedType = sanitizeString(type)
          const sanitizedId = sanitizeString(id)
          const sanitizedEngine = sanitizeString(engine)

          if (!sanitizedType || !sanitizedId) {
            logger.log(`Invalid workload type or ID for workload ${id}`)
            return
          }

          const processName = `${sanitizedType}_${sanitizedEngine}`
          const process = processes.find((p) => p.name === processName)

          await processWorkloadHealthCheck(
            payload,
            workload as Workload,
            process,
            processName,
          )
        } catch (error) {
          logger.error(
            `Error processing health check for workload ${id}:`,
            error,
          )
        } finally {
          checkingWorkloads.delete(id)
        }
      }),
    )
  } catch (err) {
    logger.error('Health check failed:', err)
  }
}

/**
 * Initializes the workload health check service with periodic monitoring
 * @param payload - The Payload CMS instance
 */
export const initHealthCheckService = (payload: BasePayload): void => {
  // Clear any existing interval
  if (globalThis.workloadHealthCheckInterval) {
    clearInterval(globalThis.workloadHealthCheckInterval)
  }

  logger.log('Starting workload health check service with 10 second interval')

  // Set up the health check interval
  globalThis.workloadHealthCheckInterval = setInterval(() => {
    processHealthChecks(payload).catch((error) => {
      logger.error('Health check service error:', error)
    })
  }, HEALTHCHECK_INTERVAL)

  // Run initial health check
  processHealthChecks(payload).catch((error) => {
    logger.error('Initial health check error:', error)
  })
}

/**
 * Stops the workload health check service
 */
export const stopHealthCheckService = (): void => {
  if (globalThis.workloadHealthCheckInterval) {
    clearInterval(globalThis.workloadHealthCheckInterval)
    globalThis.workloadHealthCheckInterval = undefined
    logger.log('Stopped workload health check service')
  }
}

/**
 * Utility functions exported for testing purposes
 */
export { retryWithBackoff, isPidAlive }

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Health probes: the row's HTTP check (200 from the instance itself, plus its JSONata response
 * mapper) and, for docker suites, the container's own health.
 */

import jsonata from 'jsonata'
import { sleep } from '@/lib/async'
import { getErrorMessage } from '@/lib/errors'
import { getInstanceKey } from '@/lib/instances/instances'
import { logger } from '@/lib/logger'
import { runCommand } from '@/lib/system/spawn'
import { isInstancePort } from '@/lib/workers/instance-ports'
import { answeredByOtherInstance, fetchLoopback } from '@/lib/workers/loopback'
import type { Service } from '@/payload-types'

/** One HTTP or docker probe. */
const HEALTHCHECK_TIMEOUT_MS = 3000

export interface RetryConfig {
  maxRetries: number
  initialDelay: number
  backoffFactor: number
  maxDelay: number
}

/** A running instance: patient, so a slow answer is not a failure. */
const HEALTHCHECK_RETRY_CONFIG: RetryConfig = {
  maxRetries: 6,
  initialDelay: 1000,
  backoffFactor: 2,
  maxDelay: 64000,
}

/** An instance starting up: quick retries, the next tick tries again. */
export const PREPARE_STATUS_RETRY_CONFIG: RetryConfig = {
  maxRetries: 10,
  initialDelay: 1000,
  backoffFactor: 1.5,
  maxDelay: 3000,
}

// Validates a Docker container name to prevent command injection (OWASP A03).
// Docker compose auto-names containers as <project>-<service>-<index>.
const CONTAINER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/

/** The docker container a health check names, or null when it is not a docker check. */
export function getDockerContainer(
  healthCheck: Service['healthCheck'] | null | undefined,
): string | null {
  const container = healthCheck?.['container']
  return healthCheck?.['type'] === 'docker' && typeof container === 'string'
    ? container
    : null
}

/**
 * Whether a named Docker container is healthy: its HEALTHCHECK status when
 * the image defines one, else whether it is running.
 */
export async function performDockerHealthCheck(
  containerName: string,
): Promise<boolean> {
  if (!CONTAINER_NAME_PATTERN.test(containerName)) {
    logger.log(
      `Docker health check skipped: invalid container name '${containerName}'`,
    )
    return false
  }

  try {
    const { stdout, exitCode, stderr } = await runCommand(
      'docker',
      ['inspect', '--format', '{{json .State}}', containerName],
      { timeoutMs: HEALTHCHECK_TIMEOUT_MS },
    )
    if (exitCode !== 0) throw new Error(stderr.trim() || `exit ${exitCode}`)

    const state: unknown = JSON.parse(stdout.trim())
    const record =
      state && typeof state === 'object'
        ? (state as Record<string, unknown>)
        : {}
    const health = record.Health
    const healthStatus =
      health && typeof health === 'object' && 'Status' in health
        ? String(health.Status)
        : undefined

    if (healthStatus) {
      const healthy = healthStatus === 'healthy'
      logger.debug(
        `Docker health check for '${containerName}': ${healthStatus} → ${healthy ? 'healthy' : 'unhealthy'}`,
      )
      return healthy
    }

    const running = record.Status === 'running'
    logger.debug(
      `Docker health check for '${containerName}' (no HEALTHCHECK): state=${String(record.Status)} → ${running ? 'healthy' : 'unhealthy'}`,
    )
    return running
  } catch (error) {
    logger.log(
      `Docker health check failed for '${containerName}': ${getErrorMessage(error)}`,
    )
    return false
  }
}

/**
 * A relative health URL path (`/healthcheck`), or null for anything that could reach elsewhere
 * (absolute URL, `//host`, `..`, backslash): SSRF / path traversal protection.
 */
function validateHealthUrl(healthUrl: string): string | null {
  const sanitized = healthUrl.trim()
  if (!sanitized) {
    logger.log(`Invalid health URL: ${healthUrl}`)
    return null
  }
  if (sanitized.includes('..') || sanitized.includes('\\')) {
    logger.log(`Path traversal attempt detected: ${sanitized}`)
    return null
  }
  if (
    sanitized.includes('://') ||
    sanitized.includes('//') ||
    /^[a-z]+:/i.test(sanitized)
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

/** The health check path for a port of the instance range, or null. */
function healthCheckPath(port: number, healthUrl: string): string | null {
  if (!port || !isInstancePort(port)) {
    logger.log(
      `Invalid or disallowed port: ${port}. Service ports must come from the instance port range.`,
    )
    return null
  }
  return validateHealthUrl(healthUrl)
}

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  retryConfig: RetryConfig,
): Promise<T> {
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
        logger.debug(
          `Health check attempt ${attempt + 1} failed, retrying in ${delay}ms: ${getErrorMessage(error)}`,
        )
        await sleep(delay)
      }
    }
  }
  throw lastError
}

/** Whether the response body matches the row's JSONata `responseMapper`. */
async function validateHealthCheckResponse(
  response: Response,
  service: Service,
): Promise<boolean> {
  const mapper = service.healthCheck?.responseMapper
  if (!mapper) return true

  try {
    const responseBody: unknown = await response.json()
    logger.debug(
      `Health check response for service ${service.id}: ${JSON.stringify(responseBody)}`,
    )

    for (const [servicePath, expression] of Object.entries(mapper)) {
      if (!expression) continue

      let actualValue: unknown
      try {
        actualValue = await jsonata(expression).evaluate(responseBody, {
          service,
        })
      } catch (err) {
        logger.log(`JSONata error for ${expression}: ${err}`)
        return false
      }

      const expectedValue: unknown =
        await jsonata(servicePath).evaluate(service)
      if (!expectedValue) {
        logger.debug(
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

async function fetchHealthEndpoint(
  port: number,
  path: string,
  service: Service,
): Promise<boolean> {
  const response = await fetchLoopback(port, path, {
    signal: AbortSignal.timeout(HEALTHCHECK_TIMEOUT_MS),
  })
  // Another instance on this port is not this one, however healthy; asking
  // again would not change who answers.
  const key = getInstanceKey(service)
  const other = answeredByOtherInstance(response, key)
  if (other) {
    await response.body?.cancel()
    logger.log(`Health check of ${key}: port ${port} is answered by ${other}`)
    return false
  }
  if (response.status !== 200) {
    await response.body?.cancel()
    throw new Error(`Health check returned status ${response.status}`)
  }
  return validateHealthCheckResponse(response, service)
}

/**
 * The row's own HTTP health check, retried per `retryConfig`. True when it
 * has none. Throws only for a URL or port it must not probe.
 */
export async function performHealthCheck(
  service: Service,
  port: number,
  retryConfig: RetryConfig = HEALTHCHECK_RETRY_CONFIG,
): Promise<boolean> {
  if (!service.healthCheck?.url) {
    logger.debug(
      `No health check URL configured for service ${service.id}, skipping`,
    )
    return true
  }

  const path = healthCheckPath(port, service.healthCheck.url)
  if (!path) throw new Error('Invalid health check URL or port')

  try {
    return await retryWithBackoff(
      () => fetchHealthEndpoint(port, path, service),
      retryConfig,
    )
  } catch (error) {
    const configType =
      retryConfig === PREPARE_STATUS_RETRY_CONFIG ? 'Prepare status ' : ''
    logger.log(
      `${configType}healthcheck failed after all retries for service ${service.id} (${service.name}): ${getErrorMessage(error)}`,
    )
    return false
  }
}

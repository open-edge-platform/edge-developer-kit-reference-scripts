// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Health poller state machine: the status and health a row should have now. Decides only. */

import { engineServers } from '@/engines/_generated/engines'
import type { PayloadStatus } from '@/lib/instances/service-status'
import { globalSingleton } from '@/lib/global-singleton'
import { logger } from '@/lib/logger'
import { isPidAlive } from '@/lib/system/processes'
import { getRowExecutionMode } from '@/lib/workers/execution-mode'
import {
  getDockerContainer,
  performDockerHealthCheck,
  performHealthCheck,
  PREPARE_STATUS_RETRY_CONFIG,
} from '@/lib/workers/health/probes'
import {
  type ProcessInfo,
  removeDeadProcess,
} from '@/lib/workers/process-handler'
import type { Service } from '@/payload-types'

export interface StatusResult {
  newStatus: PayloadStatus | null
  newIsHealthy: boolean | null
  /** Why the row is being moved to `error`; shown on its instance row. */
  statusMessage?: string
}

const UNCHANGED: StatusResult = { newStatus: null, newIsHealthy: null }

/**
 * Consecutive unhealthy ticks (~10 s each plus retries) before an active engine instance goes to
 * `error`: rides out a model reload, not a lost model or dead engine.
 */
const ENGINE_UNHEALTHY_TICKS_BEFORE_ERROR = 3

const unhealthyTicks = globalSingleton(
  'healthUnhealthyTicks',
  () => new Map<number, number>(),
)

/** Forgets a row's unhealthy streak (it stopped, or recovered). */
export function resetUnhealthyTicks(id: number): void {
  unhealthyTicks.delete(id)
}

function healthResult(healthy: boolean, status: PayloadStatus): StatusResult {
  return {
    newStatus: healthy && status !== 'active' ? 'active' : null,
    newIsHealthy: healthy,
  }
}

/** A worker's status, from its process and its own health check. */
async function determineWorkerStatus(
  service: Service,
  status: PayloadStatus,
  process: ProcessInfo | undefined,
  processName: string,
): Promise<StatusResult> {
  const { id, healthCheck, port } = service

  if (!process) {
    logger.log(`Process for ${id} not found. Marking as error.`)
    return {
      newStatus: 'error',
      newIsHealthy: false,
      statusMessage: 'The worker process is not running',
    }
  }

  if (!isPidAlive(process.pid)) {
    logger.log(
      `Process ${id} (PID: ${process.pid}) no longer exists. Marking as error.`,
    )
    removeDeadProcess(processName)
    return {
      newStatus: 'error',
      newIsHealthy: false,
      statusMessage: 'The worker process exited unexpectedly',
    }
  }

  switch (process.status) {
    case 'active': {
      if (healthCheck?.url && port) {
        // Keep the process running even if unhealthy — only the flag moves.
        return healthResult(await performHealthCheck(service, port), status)
      }
      const dockerContainer = getDockerContainer(healthCheck)
      if (dockerContainer !== null) {
        return healthResult(
          await performDockerHealthCheck(dockerContainer),
          status,
        )
      }
      if (
        !healthCheck?.url &&
        healthCheck?.['type'] !== 'docker' &&
        status !== 'active'
      ) {
        return { newStatus: 'active', newIsHealthy: true }
      }
      return UNCHANGED
    }
    case 'stopped':
      return { newStatus: 'inactive', newIsHealthy: false }
    case 'error':
      return {
        newStatus: 'error',
        newIsHealthy: false,
        statusMessage: 'The worker process reported an error',
      }
  }
}

/**
 * An engine instance's status: one quick reachability probe first (so a dead engine is not retried
 * for a minute each tick), then the backend health check. Unhealthy past the grace window → `error`
 * with the engine's explanation, which also stops what is left and frees the port.
 */
async function determineEngineStatus(
  service: Service,
  status: PayloadStatus,
  engineId: string,
): Promise<StatusResult> {
  const { id, healthCheck, port } = service
  const engine = engineServers[engineId]
  if (!engine || !healthCheck?.url || !port) {
    logger.log(`Service ${id} on ${engineId} has no health check or port`)
    return UNCHANGED
  }

  const healthy =
    (await engine.isReachable(port)) &&
    (await performHealthCheck(service, port))
  if (healthy) {
    unhealthyTicks.delete(id)
    return {
      newStatus: status !== 'active' ? 'active' : null,
      newIsHealthy: true,
    }
  }

  const ticks = (unhealthyTicks.get(id) ?? 0) + 1
  unhealthyTicks.set(id, ticks)
  if (status === 'active' && ticks >= ENGINE_UNHEALTHY_TICKS_BEFORE_ERROR) {
    unhealthyTicks.delete(id)
    const statusMessage = await engine.describeUnhealthy(service, port)
    return { newStatus: 'error', newIsHealthy: false, statusMessage }
  }
  return { newStatus: null, newIsHealthy: false }
}

/** The status of a running (or active) row, on its execution mode. */
export function determineServiceStatus(
  service: Service,
  status: PayloadStatus,
  process: ProcessInfo | undefined,
  processName: string,
): Promise<StatusResult> {
  const mode = getRowExecutionMode(service)
  if (mode === 'worker') {
    return determineWorkerStatus(service, status, process, processName)
  }
  if (mode === 'none') return Promise.resolve(UNCHANGED)
  return determineEngineStatus(service, status, mode)
}

/** A row in `prepare`: aggressive retries, `active` as soon as it answers. */
export async function determinePrepareStatus(
  service: Service,
  process: ProcessInfo,
): Promise<StatusResult> {
  const { id, healthCheck, port } = service

  if (process.status === 'error' || process.status === 'stopped') {
    return {
      newStatus: 'error',
      newIsHealthy: false,
      statusMessage: 'The process exited while starting up',
    }
  }
  if (!isPidAlive(process.pid)) return UNCHANGED

  // An engine's start ends once the model is loaded; before that its
  // backend check can already pass on a model still loading.
  const mode = getRowExecutionMode(service)
  if (
    mode !== 'worker' &&
    mode !== 'none' &&
    engineServers[mode]?.isStarting(process.name)
  ) {
    logger.debug(`Service ${id} engine still loading, will retry next interval`)
    return { newStatus: null, newIsHealthy: false }
  }

  if (healthCheck?.url && port) {
    logger.debug(
      `Service ${id} in prepare status, performing aggressive health check...`,
    )
    if (await performHealthCheck(service, port, PREPARE_STATUS_RETRY_CONFIG)) {
      logger.log(`Service ${id} healthy, transitioning prepare → active`)
      return { newStatus: 'active', newIsHealthy: true }
    }
    logger.debug(`Service ${id} still preparing, will retry next interval`)
    return { newStatus: null, newIsHealthy: false }
  }

  const dockerContainer = getDockerContainer(healthCheck)
  if (dockerContainer !== null) {
    logger.debug(
      `Service ${id} in prepare status, checking docker container '${dockerContainer}'...`,
    )
    if (await performDockerHealthCheck(dockerContainer)) {
      logger.log(
        `Service ${id} docker container healthy, transitioning prepare → active`,
      )
      return { newStatus: 'active', newIsHealthy: true }
    }
    logger.debug(
      `Service ${id} docker container not yet healthy, will retry next interval`,
    )
    return { newStatus: null, newIsHealthy: false }
  }

  logger.log(`Service ${id} process active, transitioning prepare → active`)
  return { newStatus: 'active', newIsHealthy: true }
}

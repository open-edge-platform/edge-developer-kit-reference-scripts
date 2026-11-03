// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Health poller: checks every `services` row against its process and probes each interval, writes
 * status/health changes, and fails a start that outlasts the startup timeout.
 */

import type { BasePayload } from 'payload'
import { globalSingleton } from '@/lib/global-singleton'
import { getInstanceProcessName } from '@/lib/instances/instances'
import type { PayloadStatus } from '@/lib/instances/service-status'
import { logger } from '@/lib/logger'
import { APP_SETTINGS_DEFAULTS } from '@/lib/settings/app-settings'
import { isPidAlive } from '@/lib/system/processes'
import {
  determinePrepareStatus,
  determineServiceStatus,
  resetUnhealthyTicks,
  type StatusResult,
} from '@/lib/workers/health/status'
import {
  listProcesses,
  type ProcessInfo,
  removeDeadProcess,
} from '@/lib/workers/process-handler'
import { completeStartupAttempt } from '@/lib/workers/startup-telemetry'
import type { Service } from '@/payload-types'

const HEALTHCHECK_INTERVAL_MS = 10_000

type ServiceUpdate = Pick<Service, 'status' | 'isHealthy' | 'statusMessage'>

const poller = globalSingleton(
  'serviceHealthPoller',
  (): { interval?: NodeJS.Timeout; checking: Set<number> } => ({
    checking: new Set(),
  }),
)

// Type and process names are interpolated into paths and commands later on.
const SAFE_NAME = /^[a-zA-Z0-9\-_@]+$/

/** Whether the row still has `expected` (nothing changed it mid-check). */
async function statusUnchanged(
  payload: BasePayload,
  service: Service,
  expected: PayloadStatus,
): Promise<boolean> {
  const fresh = await payload.findByID({
    collection: 'services',
    id: service.id,
    disableErrors: true,
  })
  if (fresh?.status === expected) return true
  logger.debug(
    `Service ${service.id} changed to ${fresh?.status ?? 'deleted'} mid-check, skipping stale update`,
  )
  return false
}

/** Writes `data` to the row; false when that failed (it is logged). */
async function updateService(
  payload: BasePayload,
  id: number,
  data: ServiceUpdate,
): Promise<boolean> {
  try {
    await payload.update({ collection: 'services', id, data })
    const statusInfo = data.status ? ` status to ${data.status}` : ''
    const healthInfo =
      data.isHealthy !== undefined ? ` (isHealthy: ${data.isHealthy})` : ''
    logger.log(`Updated service ${id}${statusInfo}${healthInfo}`)
    return true
  } catch (error) {
    logger.error(`Failed to update service ${id}:`, error)
    return false
  }
}

/** One row: cleans up after a dead process, enforces the startup timeout, writes the new status. */
async function checkService(
  payload: BasePayload,
  service: Service,
  process: ProcessInfo | undefined,
  processName: string,
  startupTimeoutSeconds: number,
): Promise<void> {
  const status: PayloadStatus = service.status ?? 'inactive'
  const currentIsHealthy = service.isHealthy ?? false

  // Stopped or failed: clean up a dead process and clear the health flag.
  if (status === 'inactive' || status === 'error') {
    resetUnhealthyTicks(service.id)
    if (process && !isPidAlive(process.pid)) {
      removeDeadProcess(processName)
    }
    if (currentIsHealthy && (await statusUnchanged(payload, service, status))) {
      await updateService(payload, service.id, { isHealthy: false })
    }
    return
  }

  // The startup timeout counts from entering `prepare` (`updatedAt`).
  if (status === 'prepare') {
    const elapsed = Date.now() - new Date(service.updatedAt).getTime()
    if (elapsed >= startupTimeoutSeconds * 1000) {
      logger.warn(
        `Service ${service.id} (${service.name}) exceeded startup timeout of ${startupTimeoutSeconds}s. Marking as error.`,
      )
      await updateService(payload, service.id, {
        status: 'error',
        isHealthy: false,
        statusMessage: `Did not become healthy within ${startupTimeoutSeconds} s of starting`,
      })
      return
    }
    if (!process) return
  }

  const result: StatusResult =
    status === 'prepare' && process
      ? await determinePrepareStatus(service, process)
      : await determineServiceStatus(service, status, process, processName)

  const needsStatusUpdate =
    result.newStatus !== null && result.newStatus !== status
  const needsHealthUpdate =
    result.newIsHealthy !== null && result.newIsHealthy !== currentIsHealthy
  if (!needsStatusUpdate && !needsHealthUpdate) return
  if (!(await statusUnchanged(payload, service, status))) return

  const data: ServiceUpdate = {}
  if (needsStatusUpdate && result.newStatus !== null) {
    data.status = result.newStatus
    if (result.statusMessage) data.statusMessage = result.statusMessage
  }
  if (needsHealthUpdate && result.newIsHealthy !== null) {
    data.isHealthy = result.newIsHealthy
  }
  if (data.status === 'error') {
    logger.warn(
      `Service ${service.id} (${service.name}) → error: ${data.statusMessage ?? 'unhealthy'}`,
    )
  }
  const written = await updateService(payload, service.id, data)
  // Running: its start is over, and its reports no longer count.
  if (written && data.status === 'active') completeStartupAttempt(processName)
}

/** One tick: every row, in parallel; a row still being checked is skipped. */
async function processHealthChecks(payload: BasePayload): Promise<void> {
  const [services, appSettings] = await Promise.all([
    payload.find({ collection: 'services', pagination: false }),
    payload.findGlobal({ slug: 'app-settings', overrideAccess: true }),
  ])
  const startupTimeoutSeconds =
    appSettings.startupTimeout ?? APP_SETTINGS_DEFAULTS.startupTimeout
  const processes = listProcesses()

  await Promise.all(
    services.docs.map(async (service) => {
      const { id, type, engine } = service
      if (poller.checking.has(id)) return
      poller.checking.add(id)

      try {
        const processName = getInstanceProcessName(service)
        if (
          !SAFE_NAME.test(type) ||
          !SAFE_NAME.test(engine) ||
          !SAFE_NAME.test(processName)
        ) {
          logger.warn(`Invalid service type, engine or instance id on ${id}`)
          return
        }
        await checkService(
          payload,
          service,
          processes.find((p) => p.name === processName),
          processName,
          startupTimeoutSeconds,
        )
      } catch (error) {
        logger.error(`Error processing health check for service ${id}:`, error)
      } finally {
        poller.checking.delete(id)
      }
    }),
  )
}

/** Starts polling (restarting it when it already runs). */
export function initHealthCheckService(payload: BasePayload): void {
  clearInterval(poller.interval)
  logger.log('Starting service health check service with 10 second interval')

  const tick = () =>
    processHealthChecks(payload).catch((error) => {
      logger.error('Health check service error:', error)
    })
  poller.interval = setInterval(tick, HEALTHCHECK_INTERVAL_MS)
  tick()
}

export function stopHealthCheckService(): void {
  if (!poller.interval) return
  clearInterval(poller.interval)
  poller.interval = undefined
  logger.log('Stopped service health check service')
}

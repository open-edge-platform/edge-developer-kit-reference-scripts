// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Payload `onInit`: clears what a previous run left behind, syncs service rows with the registries
 * and `deployment.json`, starts the health poller, and stops hosted processes on exit.
 */

import type { BasePayload } from 'payload'
import { applyDeploymentConfig } from '@/lib/deployment/deployment-apply'
import { generateDeploymentDocs } from '@/lib/deployment/deployment-docs'
import { globalSingleton } from '@/lib/global-singleton'
import {
  getInstanceLabel,
  uniqueInstanceId,
  uniqueInstanceLabel,
} from '@/lib/instances/instances'
import { logger } from '@/lib/logger'
import { sweepOrphanedOvms } from '@/lib/system/orphaned-ovms'
import { checkAndHandlePortConflicts } from '@/lib/system/port-checker'
import {
  initHealthCheckService,
  stopHealthCheckService,
} from '@/lib/workers/health/poller'
import { getPortsOfRow } from '@/lib/workers/instance-ports'
import { moveLegacyDefaultArtifacts } from '@/lib/workers/instance-runtime'
import {
  canonicalizeModel,
  seedInstanceSettings,
  serverOS,
} from '@/lib/workers/instance-seed'
import { init, killAllProcesses } from '@/lib/workers/process-handler'
import type { Service } from '@/payload-types'
import { metaMap } from '@/services/_generated/meta'

async function findAllRows(payload: BasePayload): Promise<Service[]> {
  const result = await payload.find({
    collection: 'services',
    pagination: false,
    sort: 'id',
  })
  return result.docs
}

/** Nothing runs right after a start: every row is stopped and holds no port. */
async function inactivateServices(payload: BasePayload) {
  await payload.update({
    collection: 'services',
    where: {
      or: [
        { status: { not_equals: 'inactive' } },
        { isHealthy: { equals: true } },
      ],
    },
    data: {
      status: 'inactive',
      isHealthy: false,
    },
  })

  // Ports are only held while a service runs; the next start allocates afresh.
  await payload.update({
    collection: 'services',
    where: { port: { exists: true } },
    data: { port: null },
  })
}

/**
 * Legacy rows sit at instance id `default` (dev databases in push mode never run the migration):
 * give each an id derived from its name and move its data and logs along.
 */
const LEGACY_DEFAULT_INSTANCE_ID = 'default'

async function renameLegacyDefaultRows(payload: BasePayload) {
  const byType = new Map<string, Service[]>()
  for (const doc of await findAllRows(payload)) {
    byType.set(doc.type, [...(byType.get(doc.type) ?? []), doc])
  }

  for (const [type, rows] of byType) {
    const legacy = rows.find((r) => r.instanceId === LEGACY_DEFAULT_INSTANCE_ID)
    if (!legacy) continue
    // The old seeded name "Default" says nothing; name it after the service.
    const serviceName = metaMap[legacy.type]?.name ?? type
    const label =
      !legacy.label || legacy.label === 'Default' ? serviceName : legacy.label
    const takenLabels = rows.filter((r) => r !== legacy).map(getInstanceLabel)
    const uniqueLabel = uniqueInstanceLabel(label, takenLabels)
    const instanceId = uniqueInstanceId(
      uniqueLabel,
      rows.filter((r) => r !== legacy).map((r) => r.instanceId),
    )
    try {
      moveLegacyDefaultArtifacts(legacy, instanceId)
      await payload.update({
        collection: 'services',
        id: legacy.id,
        data: { instanceId, label: uniqueLabel },
      })
      logger.log(
        `🔄 ${type}: instance "default" is now "${instanceId}" (/api/${type}@${instanceId})`,
      )
    } catch (error) {
      logger.error(`Failed to rename the ${type} "default" instance:`, error)
    }
  }
}

/**
 * Keeps each row's engine and health check in line with the registry, keeping its name, id and model
 * choice. Never creates a row: a service has rows only once the user adds it.
 */
async function syncServiceRows(payload: BasePayload) {
  await renameLegacyDefaultRows(payload)

  const os = serverOS()
  for (const row of await findAllRows(payload)) {
    const meta = metaMap[row.type]
    if (!meta) continue
    const target = {
      name: meta.name,
      type: row.type,
      status: 'inactive' as const,
      ...seedInstanceSettings(row.type, os, row),
    }
    const fieldsToCheck = ['engine', 'healthCheck'] as const
    const hasModels = Boolean(row.models?.default?.name)
    // Keep the user's saved models (canonicalized); otherwise seed the default.
    const preservedModels = hasModels
      ? { ...row.models, default: canonicalizeModel(row.models.default) }
      : undefined
    const modelsChanged =
      hasModels &&
      JSON.stringify(preservedModels) !== JSON.stringify(row.models)
    const targetData = {
      ...target,
      ...(preservedModels && { models: preservedModels }),
    }
    const needsUpdate =
      !hasModels ||
      modelsChanged ||
      fieldsToCheck.some(
        (field) =>
          JSON.stringify(row[field]) !== JSON.stringify(targetData[field]),
      )
    if (!needsUpdate) continue

    try {
      await payload.update({
        collection: 'services',
        id: row.id,
        data: targetData,
      })
      logger.log(
        `🔄 Updated service record: ${meta.name} (${row.type}@${row.instanceId}) — config changed`,
      )
    } catch (error) {
      logger.error(
        `Failed to update service record for ${meta.name} (${row.type}@${row.instanceId}):`,
        error,
      )
    }
  }
}

/** Ports still recorded on service rows (allocated before the last shutdown). */
async function getInstancePorts(payload: BasePayload): Promise<number[]> {
  try {
    return (await findAllRows(payload)).flatMap((d) => getPortsOfRow(d))
  } catch (error) {
    logger.error('Could not read the ports recorded on service rows:', error)
    return []
  }
}

// Kept across dev reloads: the handlers are registered once per process.
const shutdown = globalSingleton('appShutdownState', () => ({
  inProgress: false,
  handlersRegistered: false,
  repeatNoticeShown: false,
}))

async function gracefulShutdown(reason: string): Promise<void> {
  if (shutdown.inProgress) return
  shutdown.inProgress = true

  logger.log(reason)
  logger.log('Stopping all hosted services...')
  stopHealthCheckService()
  await killAllProcesses()
  logger.log('All services stopped. Goodbye!')
  process.exit(0)
}

function handleTerminationSignal(reason: string): void {
  if (shutdown.inProgress) {
    if (!shutdown.repeatNoticeShown) {
      shutdown.repeatNoticeShown = true
      logger.log(
        'Shutdown already in progress — further Ctrl+C is ignored so all services can stop cleanly.',
      )
    }
    return
  }
  gracefulShutdown(reason)
}

/** Payload's `onInit`. */
export async function initApp(payload: BasePayload): Promise<void> {
  init()
  // An OVMS whose worker died keeps its port and accelerator share forever (it is no longer in a
  // tree this app walks). Reap those before the port check so their ports are free.
  const reaped = await sweepOrphanedOvms()
  if (reaped.length > 0) {
    logger.log(
      `✅ Stopped ${reaped.length} orphaned OVMS process(es): ${reaped.join(', ')}\n`,
    )
  }

  // Ports are allocated at runtime, so check the ones recorded on the rows.
  const portCheck = await checkAndHandlePortConflicts(
    await getInstancePorts(payload),
  )
  if (portCheck.killedPorts.length > 0) {
    logger.log(
      `✅ Cleaned up stale processes on ports: ${portCheck.killedPorts.join(', ')}\n`,
    )
  }
  if (portCheck.conflicts.length > 0) {
    logger.warn(
      `⚠️  ${portCheck.conflicts.length} external process(es) detected on required ports. Services on those ports may fail to start.`,
    )
  }

  await inactivateServices(payload)
  await syncServiceRows(payload)

  // deployment.json, when present, is the whole setup: it adds, configures and removes instances.
  await applyDeploymentConfig(payload)

  // Keep the deployment.json reference docs in sync with the registries.
  generateDeploymentDocs()

  initHealthCheckService(payload)

  if (!shutdown.handlersRegistered) {
    shutdown.handlersRegistered = true

    process.on('beforeExit', async (code) => {
      await gracefulShutdown(`Process beforeExit event with code: ${code}`)
    })
    process.on('SIGINT', () =>
      handleTerminationSignal('SIGINT received (Ctrl+C)'),
    )
    process.on('SIGTERM', () => handleTerminationSignal('SIGTERM received'))
  }
}

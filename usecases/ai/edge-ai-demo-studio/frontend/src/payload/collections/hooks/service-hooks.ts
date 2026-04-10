// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import path from 'node:path'
import type {
  BasePayload,
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
} from 'payload'
import { engineHandlers } from '@/engines/_generated/engines'
import { cancelMultiserveStart } from '@/engines/multiserve/process-handler'
import { WORKER_DIR } from '@/lib/constants'
import { logger } from '@/lib/logger'
import { spawnProcess, stopProcess } from '@/lib/process-handler'
import type { Service } from '@/payload-types'
import { metaMap } from '@/services/_generated/meta'
import { getExecutionModes } from '@/services/types'
import { getWorkerConfig } from '@/services/worker-registry'

const getProcessName = (doc: Service) => {
  return `${doc.type}`
}

export const deleteServiceAfterDelete: CollectionAfterDeleteHook<
  Service
> = async ({ doc }) => {
  const processName = getProcessName(doc)

  try {
    cancelMultiserveStart(doc.type)
    await stopProcess(processName)
  } catch (error) {
    logger.error(`Error stopping process for service ${processName}:`, error)
  }
  return doc
}

/**
 * Resolve the execution mode for a service by looking up its metadata.
 * Returns "worker" or an engine identifier (e.g. "multiserve").
 *
 * When a service declares multiple modes, the Payload document's `engine`
 * field is used to pick the matching one:
 *   - "custom" engine → "worker"
 *   - Otherwise, find the engine whose backends include that value.
 */
const getExecutionMode = (doc: Service): string => {
  const meta = metaMap[doc.type as keyof typeof metaMap]
  if (meta?.execution) {
    const modes = getExecutionModes(meta.execution)

    if (modes.length === 1) return modes[0]

    // Multiple modes – resolve via the Payload engine field.
    if (doc.engine === 'worker' && modes.includes('worker')) return 'worker'

    // Engine field now stores the engine ID directly (e.g. "multiserve").
    if (modes.includes(doc.engine as (typeof modes)[number])) {
      return doc.engine
    }

    // Fallback to first declared mode.
    return modes[0]
  }
  // No metadata – fall back to raw engine value.
  return doc.engine === 'worker' ? 'worker' : doc.engine
}

/**
 * Start a worker-based service using its registered WorkerConfig.
 * Each service's data.ts defines how to build CLI args and resolve paths.
 */
const startWorkerProcess = async (service: Service) => {
  const processName = getProcessName(service)
  const workerConfig = getWorkerConfig(service.type)
  const args = workerConfig ? workerConfig.buildArgs(service) : []

  let workerDir: string
  if (workerConfig?.workerSubDir) {
    const subDir =
      typeof workerConfig.workerSubDir === 'function'
        ? workerConfig.workerSubDir(service)
        : workerConfig.workerSubDir
    workerDir = path.join(WORKER_DIR, subDir)
  } else {
    workerDir = path.join(WORKER_DIR, service.type)
  }

  if (!fs.existsSync(workerDir)) {
    throw new Error(
      `Worker directory not found for service ${service.type}: ${workerDir}`,
    )
  }

  logger.info(`Starting worker for ${processName} with args: ${args.join(' ')}`)

  await spawnProcess(processName, args, {
    cwd: workerDir,
  })
}

/**
 * Start a service based on its execution mode:
 * - "worker" → spawns a Python process via the worker registry
 * - Any other mode → delegates to the matching engine handler
 */
const startService = async (service: Service, payload: BasePayload) => {
  const mode = getExecutionMode(service)

  // Services with execution mode 'none' do not spawn a process.
  // Immediately mark them as active.
  if (mode === 'none') {
    await updateServiceStatus(payload, service.id, 'active')
    return
  }

  if (mode === 'worker') {
    await startWorkerProcess(service)
    return
  }

  const handler = engineHandlers[mode]
  if (!handler) {
    throw new Error(
      `No engine handler registered for mode "${mode}" (service: ${service.type})`,
    )
  }
  handler(service, payload)
}

const updateServiceStatus = async (
  payload: BasePayload,
  id: number,
  status: Service['status'],
) => {
  await payload.update({
    collection: 'services',
    id,
    data: { status },
  })
}

const tryStartService = async (service: Service, payload: BasePayload) => {
  try {
    await startService(service, payload)
  } catch {
    await updateServiceStatus(payload, service.id, 'error')
  }
}

export const afterServiceChange: CollectionAfterChangeHook<Service> = async ({
  doc,
  previousDoc,
  operation,
  req: { payload },
}) => {
  if (operation !== 'update') {
    if (doc.status !== 'inactive') {
      await tryStartService(doc, payload)
    }
    return
  }

  if (previousDoc.status === doc.status) return

  const processName = getProcessName(doc)

  switch (doc.status) {
    case 'inactive':
      cancelMultiserveStart(doc.type)
      await stopProcess(processName)
      return
    case 'restart':
      cancelMultiserveStart(doc.type)
      await stopProcess(processName)
      await updateServiceStatus(payload, doc.id, 'prepare')
      return
    case 'prepare':
      await tryStartService(doc, payload)
      return
    default:
      return
  }
}

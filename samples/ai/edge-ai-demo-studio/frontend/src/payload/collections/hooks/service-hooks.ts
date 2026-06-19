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
import { assertDockerAvailable } from '@/lib/docker'
import { logger } from '@/lib/logger'
import {
  runProcessCommand,
  spawnProcess,
  stopProcess,
} from '@/lib/process-handler'
import type { Service } from '@/payload-types'
import { metaMap } from '@/services/_generated/meta'
import { getExecutionModes } from '@/services/types'
import { getWorkerConfig } from '@/services/worker-registry'

const getProcessName = (doc: Service) => {
  return `${doc.type}`
}

const isWindows = process.platform === 'win32'

const runWorkerStopScript = async (service: Service) => {
  const workerConfig = getWorkerConfig(service.type)
  if (!workerConfig?.stopScript) return

  const processName = getProcessName(service)
  const workerDir = resolveWorkerDir(service)
  const scriptName = isWindows ? 'stop.ps1' : 'stop.sh'
  const scriptPath = path.join(workerDir, scriptName)

  if (!fs.existsSync(scriptPath)) {
    logger.warn(
      `Stop script not found for service ${service.type}: ${scriptPath}`,
    )
    return
  }

  const success = await runProcessCommand(
    processName,
    isWindows
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
      : [scriptPath],
    {
      command: isWindows ? 'powershell' : 'bash',
      cwd: workerDir,
    },
  )

  if (!success) {
    logger.error(`Stop script failed for service ${service.type}`)
  }
}

const stopWorkerProcess = async (service: Service) => {
  const processName = getProcessName(service)
  await stopProcess(processName)
  await runWorkerStopScript(service)
}

export const deleteServiceAfterDelete: CollectionAfterDeleteHook<
  Service
> = async ({ doc }) => {
  const processName = getProcessName(doc)

  try {
    cancelMultiserveStart(doc.type)
    await stopWorkerProcess(doc)
  } catch (error) {
    logger.error(`Error stopping process for service ${processName}:`, error)
  }
  return doc
}

// Resolves execution mode from service metadata and Payload engine field
const getExecutionMode = (doc: Service): string => {
  const meta = metaMap[doc.type as keyof typeof metaMap]
  if (meta?.execution) {
    const modes = getExecutionModes(meta.execution)

    if (modes.length === 1) return modes[0]

    if (doc.engine === 'worker' && modes.includes('worker')) return 'worker'

    if (modes.includes(doc.engine as (typeof modes)[number])) {
      return doc.engine
    }

    return modes[0]
  }
  return doc.engine === 'worker' ? 'worker' : doc.engine
}

const resolveWorkerDir = (service: Service): string => {
  const workerConfig = getWorkerConfig(service.type)

  if (workerConfig?.workerSubDir) {
    const subDir =
      typeof workerConfig.workerSubDir === 'function'
        ? workerConfig.workerSubDir(service)
        : workerConfig.workerSubDir
    return path.join(WORKER_DIR, subDir)
  }
  return path.join(WORKER_DIR, service.type)
}

const startWorkerProcess = async (service: Service) => {
  const processName = getProcessName(service)
  const workerConfig = getWorkerConfig(service.type)
  const args = workerConfig ? workerConfig.buildArgs(service) : []

  const workerDir = resolveWorkerDir(service)

  if (!fs.existsSync(workerDir)) {
    throw new Error(
      `Worker directory not found for service ${service.type}: ${workerDir}`,
    )
  }

  if (workerConfig?.requiresDocker) {
    await assertDockerAvailable()
  }

  logger.info(`Starting worker for ${processName} with args: ${args.join(' ')}`)

  await spawnProcess(processName, args, {
    cwd: workerDir,
  })
}

const startService = async (service: Service, payload: BasePayload) => {
  const mode = getExecutionMode(service)

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
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown startup error'
    logger.error(`Service ${service.type} failed to start: ${message}`)
    await payload.update({
      collection: 'services',
      id: service.id,
      data: { status: 'error', statusMessage: message },
    })
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

  switch (doc.status) {
    case 'inactive':
      cancelMultiserveStart(doc.type)
      await stopWorkerProcess(doc)
      return
    case 'restart':
      cancelMultiserveStart(doc.type)
      await stopWorkerProcess(doc)
      await updateServiceStatus(payload, doc.id, 'prepare')
      return
    case 'prepare':
      await tryStartService(doc, payload)
      return
    default:
      return
  }
}

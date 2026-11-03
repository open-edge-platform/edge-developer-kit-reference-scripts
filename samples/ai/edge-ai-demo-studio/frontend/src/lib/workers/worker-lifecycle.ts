// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Starts and stops an instance's worker process or engine as its `services` row's status changes. */

import fs from 'node:fs'
import path from 'node:path'
import type { BasePayload } from 'payload'
import { engineServers } from '@/engines/_generated/engines'
import { globalSingleton } from '@/lib/global-singleton'
import { getInstanceProcessName } from '@/lib/instances/instances'
import { getServiceMetadata } from '@/lib/instances/service-metadata'
import { logger } from '@/lib/logger'
import { assertDockerAvailable } from '@/lib/system/docker'
import {
  forgetAppliedConfig,
  recordAppliedConfig,
} from '@/lib/workers/applied-config'
import {
  ensureInstancePort,
  releaseInstancePort,
} from '@/lib/workers/instance-ports'
import {
  buildInstanceArgs,
  buildInstanceEnv,
  ensureInstanceDataDir,
} from '@/lib/workers/instance-runtime'
import {
  getStatus,
  removeDeadProcess,
  runProcessCommand,
  spawnProcess,
  stopProcess,
} from '@/lib/workers/process-handler'
import {
  beginStartupAttempt,
  cancelStartupAttempt,
  completeStartupAttempt,
  failStartupAttempt,
  recordStartupEvent,
} from '@/lib/workers/startup-telemetry'
import { getRowExecutionMode } from '@/lib/workers/execution-mode'
import { resolveWorkerDir } from '@/lib/workers/worker-dir'
import type { Service } from '@/payload-types'
import { getWorkerConfig } from '@/services/worker-registry'

const isWindows = process.platform === 'win32'

function cancelEngineStarts(processName: string): void {
  for (const engine of Object.values(engineServers)) {
    engine.cancelStart(processName)
  }
}

async function runWorkerStopScript(service: Service): Promise<void> {
  if (!getWorkerConfig(service.type)?.stopScript) return

  const workerDir = resolveWorkerDir(service)
  const scriptPath = path.join(workerDir, isWindows ? 'stop.ps1' : 'stop.sh')
  if (!fs.existsSync(scriptPath)) {
    logger.warn(
      `Stop script not found for service ${service.type}: ${scriptPath}`,
    )
    return
  }

  const success = await runProcessCommand(
    getInstanceProcessName(service),
    isWindows
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
      : [scriptPath],
    { command: isWindows ? 'powershell' : 'bash', cwd: workerDir },
  )
  if (!success) {
    logger.error(`Stop script failed for service ${service.type}`)
  }
}

/**
 * Stops whatever runs for an instance: an engine start in progress, its process (worker and engine
 * share the process name) and the worker's stop script, if any.
 */
export async function stopInstance(service: Service): Promise<void> {
  forgetAppliedConfig(service)
  // A start in progress ends here; a failed one stays for its error row.
  cancelStartupAttempt(getInstanceProcessName(service))
  cancelEngineStarts(getInstanceProcessName(service))
  await stopProcess(getInstanceProcessName(service))
  await runWorkerStopScript(service)
}

/** `attemptId`: the start attempt the worker's startup reports count for. */
async function startWorkerProcess(
  service: Service,
  attemptId: string,
): Promise<void> {
  const processName = getInstanceProcessName(service)
  const workerConfig = getWorkerConfig(service.type)
  const args = workerConfig ? workerConfig.buildArgs(service) : []

  const workerDir = resolveWorkerDir(service)
  if (!fs.existsSync(/* turbopackIgnore: true */ workerDir)) {
    throw new Error(
      `Worker directory not found for service ${service.type}: ${workerDir}`,
    )
  }

  if (workerConfig?.requiresDocker) {
    await assertDockerAvailable()
  }

  // Every instance gets its own writable directory and knows its identity;
  // workers that have not opted out also get them as arguments.
  const dataDir = ensureInstanceDataDir(service)
  const fullArgs =
    workerConfig?.acceptsInstanceArgs === false
      ? args
      : [...args, ...buildInstanceArgs(service, dataDir)]

  logger.info(
    `Starting worker for ${processName} with args: ${fullArgs.join(' ')}`,
  )

  // An engine under this per-instance name (e.g. started from Runtime Settings before an engine
  // switch), or a stale exited entry, would make spawnProcess() skip as "already running" and
  // strand the row in `prepare`. The slot belongs to this worker now: clear it first.
  const holder = getStatus(processName)
  if (holder?.status === 'stopped') {
    removeDeadProcess(processName)
  } else if (holder) {
    logger.warn(
      `[${processName}] slot held by another process (pid ${holder.pid}); stopping it before starting the worker`,
    )
    await stopProcess(processName)
  }

  const spawned = await spawnProcess(processName, fullArgs, {
    cwd: workerDir,
    env: buildInstanceEnv(service, dataDir),
    cpuAffinity: getServiceMetadata(service).cpuAffinity,
    onStartupEvent: (event) =>
      recordStartupEvent(processName, attemptId, event),
  })
  if (spawned.kind === 'failed') throw new Error(spawned.error)
}

async function setStatus(
  payload: BasePayload,
  id: number,
  data: Pick<Service, 'status' | 'statusMessage'>,
): Promise<void> {
  await payload.update({ collection: 'services', id, data })
}

async function startOnMode(
  service: Service,
  payload: BasePayload,
  attemptId: string,
) {
  const mode = getRowExecutionMode(service)

  if (mode === 'none') {
    await setStatus(payload, service.id, { status: 'active' })
    completeStartupAttempt(getInstanceProcessName(service))
    return
  }
  if (mode === 'worker') {
    await startWorkerProcess(service, attemptId)
    return
  }

  const engine = engineServers[mode]
  if (!engine) {
    throw new Error(
      `No engine registered for mode "${mode}" (service: ${service.type})`,
    )
  }
  // Not awaited: an engine start can outlast what a hook may hold the request for; it marks the
  // row itself on failure and reports under `currentStartupAttempt`.
  engine.start(service, payload).catch((error) => {
    logger.error(`Engine start for ${service.type} failed:`, error)
  })
}

/** Starts an instance on its execution mode as a new start attempt; a failure moves the row to `error`. */
export async function startInstance(
  service: Service,
  payload: BasePayload,
): Promise<void> {
  const processName = getInstanceProcessName(service)
  const attemptId = beginStartupAttempt(processName)
  try {
    const withPort = await ensureInstancePort(payload, service)
    await startOnMode(withPort, payload, attemptId)
    // What this run uses, for "Restart to apply" (see applied-config.ts).
    recordAppliedConfig(withPort)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown startup error'
    logger.error(`Service ${service.type} failed to start: ${message}`)
    recordStartupEvent(processName, attemptId, {
      type: 'failure',
      summary: message,
    })
    await setStatus(payload, service.id, {
      status: 'error',
      statusMessage: message,
    })
  }
}

/**
 * Stops in flight by process name. A start arriving mid-stop must wait, or it would run on the port
 * the stop then frees, and the stop could kill the process it just spawned. On `globalThis` because
 * dev may load this module more than once.
 */
const pendingStops = globalSingleton(
  'servicePendingStops',
  () => new Map<string, Promise<void>>(),
)

export async function awaitPendingStop(service: Service): Promise<void> {
  const pending = pendingStops.get(getInstanceProcessName(service))
  if (pending) await pending.catch(() => undefined)
}

/**
 * Stops an instance now in `status`, then frees its port unless the row has left `status` (a start
 * that raced the stop waits in `awaitPendingStop` and keeps it).
 */
function stopAndReleasePort(
  doc: Service,
  payload: BasePayload,
  status: 'inactive' | 'error',
): Promise<void> {
  const processName = getInstanceProcessName(doc)
  const run = (async () => {
    await stopInstance(doc)
    await releaseInstancePort(payload, doc, status)
  })()
  const tracked = run.finally(() => {
    if (pendingStops.get(processName) === tracked) {
      pendingStops.delete(processName)
    }
  })
  pendingStops.set(processName, tracked)
  return tracked
}

/** Stops an instance that went `inactive` and hands its port back to the range. */
export function stopInactiveInstance(
  doc: Service,
  payload: BasePayload,
): Promise<void> {
  return stopAndReleasePort(doc, payload, 'inactive')
}

/**
 * Stops what is left of an instance in `error` and frees its port. Its start
 * attempt is frozen first, so the error row keeps the step it failed in.
 */
export function cleanUpErroredInstance(
  doc: Service,
  payload: BasePayload,
): Promise<void> {
  failStartupAttempt(getInstanceProcessName(doc))
  return stopAndReleasePort(doc, payload, 'error')
}

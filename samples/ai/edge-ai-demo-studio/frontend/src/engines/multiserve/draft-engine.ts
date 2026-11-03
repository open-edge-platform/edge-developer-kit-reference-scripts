// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * One multiserve engine per service type with no `services` row, so the New-instance sheet can
 * manage models before its instance exists. Started on request only, it holds a port from the
 * instance range in memory, answers at `/api/<type>@_draft/…` and shares the type's models
 * directory. Stopped when its sheet goes away or after `IDLE_STOP_MS` unused (a closed tab).
 */

import type { BasePayload } from 'payload'
import { globalSingleton } from '@/lib/global-singleton'
import {
  DRAFT_ENGINE_INSTANCE_ID,
  getDraftEngineKey,
} from '@/lib/instances/instances'
import { logger } from '@/lib/logger'
import {
  ensureRowlessPort,
  getRowlessPort,
  releaseRowlessPort,
} from '@/lib/workers/instance-ports'
import {
  getStatus,
  removeDeadProcess,
  stopProcess,
} from '@/lib/workers/process-handler'
import { removeInstanceDataDir } from '@/lib/workers/instance-runtime'
import type { Service } from '@/payload-types'
import {
  cancelMultiserveStart,
  ensureMultiserveEngine,
  getMultiserveEngineState,
  type MultiserveEngineTarget,
} from './process-handler'

const IDLE_STOP_MS = 10 * 60_000
const IDLE_CHECK_INTERVAL_MS = 60_000

// On `globalThis` like the port registry: dev bundles each route separately.
const starts = globalSingleton(
  'draftEngineStarts',
  () => new Map<string, Promise<boolean>>(),
)
const types = globalSingleton(
  'draftEngineTypes',
  () => new Set<Service['type']>(),
)
const idleSweep = globalSingleton(
  'draftEngineIdleSweep',
  (): { timer?: ReturnType<typeof setInterval> } => ({}),
)

// Callers check that `type` runs on multiserve (engines cannot read the
// service registry).
const draftTarget = (
  type: Service['type'],
  port: number,
): MultiserveEngineTarget => ({
  type,
  instanceId: DRAFT_ENGINE_INSTANCE_ID,
  name: getDraftEngineKey(type),
  port,
  // No model is loaded, so the device only matters for GPU visibility.
  models: { default: { device: 'CPU' } },
})

/**
 * Reserves the draft engine's port — throws `InstancePortExhaustedError`
 * when the range is full — so the caller can answer before the start runs.
 */
export function reserveDraftEnginePort(
  payload: BasePayload,
  type: Service['type'],
): Promise<number> {
  return ensureRowlessPort(payload, getDraftEngineKey(type), {
    engine: 'multiserve',
    type,
  })
}

/** Starts the draft engine on its reserved port; concurrent calls share one start. */
export function startDraftEngine(
  type: Service['type'],
  port: number,
): Promise<boolean> {
  const key = getDraftEngineKey(type)
  const running = starts.get(key)
  if (running) return running

  types.add(type)
  if (idleSweep.timer === undefined) {
    idleSweep.timer = setInterval(() => {
      stopIdleDraftEngines()
    }, IDLE_CHECK_INTERVAL_MS)
    idleSweep.timer.unref?.()
  }

  const start: Promise<boolean> = ensureMultiserveEngine(
    draftTarget(type, port),
  )
    .catch((error) => {
      logger.error(`Error starting the ${key} engine:`, error)
      return false
    })
    .then((ok) => {
      if (!ok) logger.error(`The ${key} engine did not start`)
      return ok
    })
    .finally(() => {
      if (starts.get(key) === start) starts.delete(key)
    })
  starts.set(key, start)
  return start
}

export async function getDraftEngineState(
  type: Service['type'],
): Promise<{ starting: boolean; healthy: boolean }> {
  const key = getDraftEngineKey(type)
  if (starts.has(key)) return { starting: true, healthy: false }
  const held = getRowlessPort(key)
  if (!held) return { starting: false, healthy: false }
  return getMultiserveEngineState(draftTarget(type, held.port))
}

/** Stops the draft engine, cancelling a start in progress, and frees its port. */
export async function stopDraftEngine(type: Service['type']): Promise<void> {
  const key = getDraftEngineKey(type)
  const start = starts.get(key)
  cancelMultiserveStart(key)
  if (start) {
    // A cancelled start settles once its process is spawned; let it, so the
    // process is not left running without the port it was given.
    await start
    // Started again while this one wound down: that start owns it now.
    if (starts.has(key)) return
  }

  const status = getStatus(key)
  if (status && status.status !== 'stopped') {
    await stopProcess(key)
  } else if (status) {
    removeDeadProcess(key)
  }
  releaseRowlessPort(key)
  removeInstanceDataDir({ type, instanceId: DRAFT_ENGINE_INSTANCE_ID })
  types.delete(type)
  logger.log(`Stopped the ${key} engine`)
}

async function stopIdleDraftEngines(): Promise<void> {
  for (const type of types) {
    const key = getDraftEngineKey(type)
    if (starts.has(key)) continue
    const held = getRowlessPort(key)
    if (held && Date.now() - held.lastUsed < IDLE_STOP_MS) continue
    logger.log(`Stopping the ${key} engine: unused for a while`)
    await stopDraftEngine(type).catch((error) =>
      logger.error(`Failed to stop the ${key} engine:`, error),
    )
  }
}

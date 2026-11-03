// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Settings an instance starts from when there is nothing to copy, and is reset to on an engine
 * switch. Server-only (reads the platform); the client drafts from the static registry.
 */

import os from 'node:os'
import { engines } from '@/engines/_generated/meta'
import {
  getBackendByValue,
  getRecommendedBackendForService,
} from '@/engines/registry'
import type { Service } from '@/payload-types'
import { metaMap } from '@/services/_generated/meta'
import { getExecutionModes } from '@/services/execution'
import type { OS } from '@/types/common'

type ModelEntry = Service['models']['default']

const FALLBACK_MODEL: ModelEntry = {
  name: 'default',
  device: 'CPU',
}

export type InstanceSeed = Pick<Service, 'engine' | 'models' | 'healthCheck'>

/**
 * For workers whose service declares no health check (worker_common serves it). Without one a worker
 * counts as running before its port answers, and a switch to `worker` keeps the engine's check.
 */
export const DEFAULT_WORKER_HEALTH_CHECK: NonNullable<Service['healthCheck']> =
  { url: '/healthcheck' }

/** The OS the app runs on, as the registries key their defaults. */
export function serverOS(): OS {
  return os.platform() === 'win32' ? 'windows' : 'linux'
}

/** The stored form of a model: a llama.cpp quant is part of the name (`repo:Q4_K_M`). */
export function canonicalizeModel(model: ModelEntry): ModelEntry {
  if (model.backend !== 'llamacpp' || !model.quant) return model
  const { quant, ...rest } = model
  if (model.name.endsWith(`:${quant}`)) return rest
  return { ...rest, name: engines.multiserve.getModelName(model) }
}

/**
 * The default model of `serviceType` on `engine` and the health check that
 * engine answers for it: a worker's own, or the model's backend's.
 */
function seedForEngine(
  serviceType: Service['type'],
  engine: Service['engine'],
  serverOS: OS,
): { model: ModelEntry; healthCheck: Service['healthCheck'] } {
  const meta = metaMap[serviceType]
  const option = meta.execution.options?.find((o) => o.mode === engine)
  if (engine === 'worker') {
    return {
      model: option?.defaultModel ?? meta.defaultModel ?? FALLBACK_MODEL,
      healthCheck: meta.healthCheck ?? DEFAULT_WORKER_HEALTH_CHECK,
    }
  }
  const recommended = getRecommendedBackendForService(
    serviceType,
    serverOS,
    engine,
  )
  const model: ModelEntry =
    option?.defaultModel ??
    recommended?.models[serviceType]?.[0] ??
    meta.defaultModel ??
    FALLBACK_MODEL
  const backend =
    (model.backend ? getBackendByValue(model.backend) : undefined) ??
    recommended
  return {
    model: canonicalizeModel(model),
    healthCheck: backend?.healthcheck ?? undefined,
  }
}

/** Row fields for a switch to `engine`: its default model (names are engine-specific) and health check. */
export function seedEngineSwitch(
  service: Pick<Service, 'type' | 'models'>,
  engine: Service['engine'],
): Pick<Service, 'models' | 'healthCheck'> {
  const { model, healthCheck } = seedForEngine(service.type, engine, serverOS())
  return { models: { ...service.models, default: model }, healthCheck }
}

function resolveEngineBackedSeed(
  serviceType: Service['type'],
  savedModel: ModelEntry | undefined,
  serverOS: OS,
): InstanceSeed {
  const savedBackend = savedModel?.backend
    ? getBackendByValue(savedModel.backend)
    : undefined
  const backend =
    (savedBackend?.supportedServices.includes(serviceType)
      ? savedBackend
      : undefined) ?? getRecommendedBackendForService(serviceType, serverOS)

  if (!backend) {
    return { engine: 'worker', models: { default: FALLBACK_MODEL } }
  }

  const engineId = Object.entries(engines).find(([, eng]) =>
    eng.supportedBackends.some((b) => b.value === backend.value),
  )?.[0]

  return {
    engine: (engineId ?? 'worker') as Service['engine'],
    models: {
      default: canonicalizeModel(
        backend.models[serviceType]?.[0] ?? FALLBACK_MODEL,
      ),
    },
    healthCheck: backend.healthcheck ?? undefined,
  }
}

/**
 * Engine, model and health check for a new instance on this machine. With `existing`, keeps the
 * user's engine and model where the registry still allows, so boot can refresh the health check.
 */
export function seedInstanceSettings(
  serviceType: Service['type'],
  serverOS: OS,
  existing?: Pick<Service, 'engine' | 'models'>,
): InstanceSeed {
  const meta = metaMap[serviceType]
  const modes = getExecutionModes(meta.execution)
  const isEngineBacked = modes.some((m) => m !== 'worker' && m !== 'none')
  // A service offering an engine and `worker` keeps a user's switch to `worker`; the engine seed
  // would otherwise re-derive the engine from the model's backend on every start.
  const keepsWorkerEngine =
    isEngineBacked && modes.includes('worker') && existing?.engine === 'worker'

  if (isEngineBacked && !keepsWorkerEngine) {
    return resolveEngineBackedSeed(
      serviceType,
      existing?.models?.default,
      serverOS,
    )
  }
  const worker = seedForEngine(serviceType, 'worker', serverOS)
  return {
    engine: 'worker',
    models: {
      default: (keepsWorkerEngine && existing?.models?.default) || worker.model,
    },
    healthCheck: worker.healthCheck,
  }
}

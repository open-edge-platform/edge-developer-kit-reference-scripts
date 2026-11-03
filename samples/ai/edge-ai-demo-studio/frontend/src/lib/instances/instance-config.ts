// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Turns a client-sent configuration into `services` row fields, the same way for `PATCH` and `POST`
 * routes. Isomorphic: the registries only.
 */

import { getBackendByValue } from '@/engines/registry'
import type { Service } from '@/payload-types'
import { metaMap } from '@/services/_generated/meta'
import { getExecutionModes } from '@/services/execution'
import type { ExecutionMode } from '@/services/types'

type ConfigUpdate = Pick<Service, 'models' | 'healthCheck' | 'metadata'>

const ALLOWED_MODEL_FIELDS = new Set([
  'name',
  'device',
  'backend',
  'source',
  'type',
  'quant',
  'params',
])

/** Allowed model fields of `input`; `nonEmpty` drops blank strings (otherwise '' clears a field). */
export function pickModelFields(
  input: Record<string, unknown>,
  options: { nonEmpty?: boolean } = {},
): Record<string, string> {
  const picked: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (
      ALLOWED_MODEL_FIELDS.has(key) &&
      typeof value === 'string' &&
      (!options.nonEmpty || value)
    ) {
      picked[key] = value
    }
  }
  return picked
}

/**
 * `backend`'s health check when it differs from the row's backend, else `undefined`. Each backend
 * answers its own: an OVMS check never passes on llama.cpp.
 */
export function backendHealthCheck(
  row: Pick<Service, 'models'>,
  backend: string | undefined,
): Service['healthCheck'] | undefined {
  const current = row.models?.default?.backend
  return backend && backend !== current
    ? getBackendByValue(backend)?.healthcheck
    : undefined
}

/**
 * Row fields a Configure `config` body changes. Model fields replace `models.default` (both `name`
 * and `device` required); `metadata` merges into the row's, and `null` removes a key.
 */
export function buildConfigUpdate(
  row: Pick<Service, 'models' | 'metadata'>,
  config: Record<string, unknown>,
): { data: Partial<ConfigUpdate> } | { error: string } {
  const modelUpdate = pickModelFields(config)

  const metadataUpdate =
    config.metadata &&
    typeof config.metadata === 'object' &&
    !Array.isArray(config.metadata)
      ? (config.metadata as Record<string, unknown>)
      : undefined

  const hasModelFields = Object.keys(modelUpdate).length > 0

  if (!hasModelFields && !metadataUpdate) {
    return {
      error:
        "Config update requires at least one of 'name'+'device' or 'metadata'.",
    }
  }

  const { name, device } = modelUpdate
  if (hasModelFields && (!name || !device)) {
    return { error: "Model config update requires both 'name' and 'device'." }
  }

  const healthCheck = backendHealthCheck(row, modelUpdate.backend)

  return {
    data: {
      ...(hasModelFields && {
        models: {
          ...row.models,
          default: { ...modelUpdate, name, device },
        },
      }),
      ...(healthCheck ? { healthCheck } : {}),
      ...(metadataUpdate && {
        metadata: Object.fromEntries(
          Object.entries({ ...row.metadata, ...metadataUpdate }).filter(
            ([, v]) => v !== null && v !== undefined,
          ),
        ),
      }),
    },
  }
}

/**
 * Whether `engine` is one of `type`'s execution modes. `requireChoice` (switching a live row) rejects
 * any engine on a single-mode service; at creation its only mode is a harmless no-op.
 */
export function validateEngineChoice(
  type: Service['type'],
  engine: string,
  { requireChoice = false }: { requireChoice?: boolean } = {},
): { engine: Service['engine'] } | { error: string } {
  const meta = metaMap[type]
  const modes: ExecutionMode[] = meta ? getExecutionModes(meta.execution) : []
  if (requireChoice && modes.length < 2) {
    return { error: `Service '${type}' has a single execution engine.` }
  }
  const chosen = modes.find((mode) => mode === engine)
  if (chosen === undefined || chosen === 'none') {
    return {
      error: `Engine '${engine}' is not one of [${modes.join(', ')}] for '${type}'.`,
    }
  }
  return { engine: chosen }
}

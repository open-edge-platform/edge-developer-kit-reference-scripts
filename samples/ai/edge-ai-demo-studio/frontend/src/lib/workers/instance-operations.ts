// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Instance writes behind the services API (add, rename, switch engine, configure, start/stop).
 * Each throws an `ApiError` (400/409) when the request cannot be applied.
 */

import type { BasePayload } from 'payload'
import { ApiError } from '@/lib/api/errors'
import {
  backendHealthCheck,
  buildConfigUpdate,
  pickModelFields,
  validateEngineChoice,
} from '@/lib/instances/instance-config'
import {
  DEFAULT_MAX_INSTANCES,
  duplicateInstanceLabelMessage,
  findInstanceWithLabel,
  isValidInstanceId,
  uniqueInstanceId,
} from '@/lib/instances/instances'
import type { ServiceAction } from '@/lib/instances/service-status'
import { isServiceType } from '@/lib/instances/service-type'
import { logger } from '@/lib/logger'
import {
  seedEngineSwitch,
  seedInstanceSettings,
  serverOS,
} from '@/lib/workers/instance-seed'
import { stopInstance } from '@/lib/workers/worker-lifecycle'
import type { Service } from '@/payload-types'
import { metaMap } from '@/services/_generated/meta'
import { hasExecutionMode } from '@/services/execution'

/** Rows of one type an operation reads; far above any instance cap. */
const MAX_ROWS_PER_TYPE = 100

/** The type's rows in creation order, without `exceptId`. */
async function findSiblings(
  payload: BasePayload,
  type: Service['type'],
  exceptId?: number,
): Promise<Service[]> {
  const found = await payload.find({
    collection: 'services',
    where: {
      and: [
        { type: { equals: type } },
        ...(exceptId !== undefined ? [{ id: { not_equals: exceptId } }] : []),
      ],
    },
    sort: 'id',
    limit: MAX_ROWS_PER_TYPE,
  })
  return found.docs
}

export interface CreateInstanceInput {
  type: string
  label: string
  /** Explicit id for scripts; the UI derives it from `label`. Fixed for good once created. */
  instanceId?: string
  /** Row id to copy models / metadata / engine from (default: the service's first instance). */
  copyFrom?: number
  /**
   * Overrides on the copied `models.default`. With another `backend` it is the whole model (`name`
   * and `device` required) and brings that backend's health check.
   */
  model?: Record<string, unknown>
  metadata?: Record<string, unknown>
  /** A Configure-form config (as `PATCH /api/services/:id` takes), applied on the copied settings. */
  config?: Record<string, unknown>
  /** Engine differing from the source's: its default model and health check are seeded, then `config`. */
  engine?: string
  autostart?: boolean
}

/**
 * Adds an instance. The first starts from this machine's defaults (`seedInstanceSettings`); later
 * ones copy engine, model, health check and metadata from `copyFrom` (or the first instance).
 * `engine` and `config` apply on top. Stays stopped unless `autostart` is set.
 */
export async function createInstance(
  payload: BasePayload,
  input: CreateInstanceInput,
): Promise<Service> {
  const { type } = input
  if (!isServiceType(type)) throw new ApiError(400, 'Unknown service type')
  const meta = metaMap[type]
  if (hasExecutionMode(meta.execution, 'none')) {
    throw new ApiError(
      400,
      `${meta.name} runs inside the studio and has no instances`,
    )
  }
  let engine: Service['engine'] | undefined
  if (input.engine !== undefined) {
    const check = validateEngineChoice(type, input.engine)
    if ('error' in check) throw new ApiError(400, check.error)
    engine = check.engine
  }

  const label = input.label.trim()
  if (!label) throw new ApiError(400, 'Instance name is required')
  const explicitId = input.instanceId?.trim().toLowerCase()
  if (explicitId !== undefined && !isValidInstanceId(explicitId)) {
    throw new ApiError(
      400,
      'Instance id must be 1–32 lowercase letters, digits or dashes, starting and ending with a letter or digit',
    )
  }

  // In creation order: the first row is what a new instance copies.
  const siblings = await findSiblings(payload, type)
  const max = meta.multiInstance
    ? (meta.maxInstances ?? DEFAULT_MAX_INSTANCES)
    : 1
  if (siblings.length >= max) {
    throw new ApiError(
      409,
      max === 1
        ? `${meta.name} runs as a single instance`
        : `${meta.name} already has the maximum of ${max} instances`,
    )
  }
  if (findInstanceWithLabel(label, siblings)) {
    throw new ApiError(409, duplicateInstanceLabelMessage(label))
  }
  const instanceId =
    explicitId ??
    uniqueInstanceId(
      label,
      siblings.map((d) => d.instanceId),
    )
  if (siblings.some((d) => d.instanceId === instanceId)) {
    throw new ApiError(409, `An instance "${instanceId}" already exists`)
  }

  const source =
    (input.copyFrom != null
      ? siblings.find((d) => d.id === input.copyFrom)
      : undefined) ?? siblings[0]
  // Nothing to copy from: the service's own defaults on this machine.
  const base: Pick<
    Service,
    'type' | 'engine' | 'models' | 'healthCheck' | 'metadata'
  > = source ?? {
    type,
    ...seedInstanceSettings(type, serverOS()),
    metadata: undefined,
  }

  const targetEngine = engine ?? base.engine
  // `config` still wins over the seeded engine defaults below.
  const seeded =
    targetEngine !== base.engine ? seedEngineSwitch(base, targetEngine) : base
  const modelOverride = pickModelFields(input.model ?? {}, { nonEmpty: true })
  // A model on another backend keeps nothing of the copied one (quant, source and params are
  // backend-specific) and uses its own backend's health check.
  const otherBackend =
    modelOverride.backend !== undefined &&
    modelOverride.backend !== seeded.models.default?.backend
  const { name, device } = modelOverride
  if (otherBackend && (!name || !device)) {
    throw new ApiError(
      400,
      "A 'model' on another backend than the copied one requires both 'name' and 'device'.",
    )
  }
  const settings: Pick<Service, 'models' | 'healthCheck' | 'metadata'> = {
    models: {
      ...seeded.models,
      default:
        otherBackend && name && device
          ? { ...modelOverride, name, device }
          : { ...seeded.models.default, ...modelOverride },
    },
    healthCheck:
      backendHealthCheck(seeded, modelOverride.backend) ?? seeded.healthCheck,
    metadata: input.metadata ?? base.metadata ?? undefined,
  }
  const configured = input.config
    ? buildConfigUpdate(settings, input.config)
    : { data: {} }
  if ('error' in configured) throw new ApiError(400, configured.error)

  try {
    const created = await payload.create({
      collection: 'services',
      data: {
        name: meta.name,
        type,
        instanceId,
        label,
        port: null,
        engine: targetEngine,
        ...settings,
        ...configured.data,
        status: input.autostart ? 'prepare' : 'inactive',
      },
    })
    logger.log(
      source
        ? `📦 Created ${meta.name} instance "${instanceId}"`
        : `📦 Added ${meta.name} as "${label}" (${instanceId})`,
    )
    return created
  } catch (error) {
    // The collection hook explains a clash the checks above raced with.
    logger.error(`Failed to create ${type} instance "${instanceId}":`, error)
    throw new ApiError(
      400,
      error instanceof Error ? error.message : 'Failed to create instance',
      { cause: error },
    )
  }
}

/**
 * Renames an instance: only its label changes, so its address, process, data dir and bindings stay
 * and nothing restarts. Ids are deliberately immutable: callers of the address would break silently.
 */
export async function renameInstance(
  payload: BasePayload,
  service: Service,
  rawLabel: string,
): Promise<Service> {
  const label = rawLabel.trim()
  if (!label) throw new ApiError(400, 'Name cannot be empty')

  const siblings = await findSiblings(payload, service.type, service.id)
  if (findInstanceWithLabel(label, siblings)) {
    throw new ApiError(409, duplicateInstanceLabelMessage(label))
  }
  if (label === service.label) return service

  const updated = await payload.update({
    collection: 'services',
    id: service.id,
    data: { label },
  })
  logger.log(
    `✏️  ${service.type}@${service.instanceId} renamed to “${label}” — its address stays`,
  )
  return updated
}

/**
 * Switches a multi-engine service's engine. The model resets to the engine's default (model names
 * are engine-specific) and a running instance restarts.
 */
export async function switchInstanceEngine(
  payload: BasePayload,
  service: Service,
  requested: string,
): Promise<Service> {
  const check = validateEngineChoice(service.type, requested, {
    requireChoice: true,
  })
  if ('error' in check) throw new ApiError(400, check.error)
  if (check.engine === service.engine) return service

  return payload.update({
    collection: 'services',
    id: service.id,
    data: {
      engine: check.engine,
      ...seedEngineSwitch(service, check.engine),
      status: service.status !== 'inactive' ? 'restart' : service.status,
    },
  })
}

/** Saves a Configure-panel config. Never restarts: the settings apply on the next start. */
export async function configureInstance(
  payload: BasePayload,
  service: Service,
  config: Record<string, unknown>,
): Promise<Service> {
  const update = buildConfigUpdate(service, config)
  if ('error' in update) throw new ApiError(400, update.error)
  return payload.update({
    collection: 'services',
    id: service.id,
    data: update.data,
  })
}

const ACTION_TO_STATUS = {
  start: 'prepare',
  stop: 'inactive',
  restart: 'restart',
} as const satisfies Record<ServiceAction, Service['status']>

/** Starts, stops or restarts an instance through its row's status. */
export async function applyInstanceAction(
  payload: BasePayload,
  service: Service,
  action: ServiceAction,
): Promise<Service> {
  if (action === 'stop' && service.status === 'inactive') {
    // The status hook will not run, but an engine started from Runtime Settings for this stopped
    // instance (to manage models) may still be up.
    await stopInstance(service)
    return service
  }

  return payload.update({
    collection: 'services',
    id: service.id,
    data: {
      // A previous failure's reason must not outlive the retry.
      ...(action === 'stop' ? {} : { statusMessage: '' }),
      status: ACTION_TO_STATUS[action],
    },
  })
}

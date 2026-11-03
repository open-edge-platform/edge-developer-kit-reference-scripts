// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Applies `deployment.json` at boot. Applying an entry never changes an existing instance's id, so
 * its address, data and sample bindings survive a rename.
 */

import type { BasePayload } from 'payload'
import { getBackendByValue } from '@/engines/registry'
import { loadDeploymentConfig } from '@/lib/deployment/deployment-file'
import {
  type DeploymentEntry,
  type EntryMatch,
  matchDeploymentEntries,
} from '@/lib/deployment/deployment-match'
import {
  type InstanceSettings,
  selectableEngines,
  type ServiceOverride,
} from '@/lib/deployment/deployment-schema'
import {
  DEFAULT_MAX_INSTANCES,
  duplicateInstanceLabelMessage,
  findInstanceWithLabel,
  getInstanceKey,
  getInstanceLabel,
  isValidInstanceId,
  uniqueInstanceId,
  uniqueInstanceLabel,
} from '@/lib/instances/instances'
import { mergeServiceMetadata } from '@/lib/instances/service-metadata'
import { isServiceType } from '@/lib/instances/service-type'
import { logger } from '@/lib/logger'
import { waitForInstanceToSettle } from '@/lib/workers/instance-runtime'
import {
  DEFAULT_WORKER_HEALTH_CHECK,
  seedInstanceSettings,
  serverOS,
} from '@/lib/workers/instance-seed'
import type { Service } from '@/payload-types'
import { metaMap } from '@/services/_generated/meta'
import { hasExecutionMode } from '@/services/execution'
import { supportsCustomModels } from '@/services/model-config'

/** Rows of one type a step reads; far above any instance cap. */
const MAX_ROWS_PER_TYPE = 100

type ModelEntry = Service['models'][string]

function mergeModels(
  existing: Service['models'],
  overrides: NonNullable<InstanceSettings['models']>,
  where: string,
): Service['models'] {
  const merged: Service['models'] = { ...existing }

  for (const [key, override] of Object.entries(overrides)) {
    const base: Partial<ModelEntry> = merged[key] ?? {}
    const entry = { ...base, ...override }

    // The Services collection requires name + device on every model entry.
    if (!entry.name) {
      logger.warn(
        `deployment.json: ${where}.models.${key} has no 'name' and no ` +
          `stored default to inherit from — skipping this entry`,
      )
      continue
    }
    merged[key] = {
      ...entry,
      name: entry.name,
      device: (entry.device || 'CPU').toUpperCase(),
    }
  }

  return merged
}

/** Checks one instance's settings; false when they cannot be applied at all. */
function validateSettings(
  serviceType: Service['type'],
  settings: InstanceSettings,
  where: string,
): boolean {
  const meta = metaMap[serviceType]

  if (settings.engine) {
    // An engine the service cannot run on would start one thing and be health-checked as another.
    const engines = selectableEngines(serviceType)
    if (!engines.some((engine) => engine === settings.engine)) {
      logger.warn(
        `deployment.json: ${where}.engine "${settings.engine}" is not one ` +
          `of [${engines.join(', ')}] for ${meta.name} — skipping it`,
      )
      return false
    }
  }

  // Advisory only — custom models/devices are allowed for some services.
  const config = meta.config
  const defaultOverride = settings.models?.default
  if (defaultOverride?.backend && !getBackendByValue(defaultOverride.backend)) {
    logger.warn(
      `deployment.json: ${where}.models.default.backend ` +
        `"${defaultOverride.backend}" is not a registered backend — the ` +
        `health check cannot be matched to it and the instance will likely ` +
        `stay in 'prepare'`,
    )
  }
  if (defaultOverride?.name && config?.availableModels?.length) {
    const known = config.availableModels.some(
      (m) => m.value === defaultOverride.name,
    )
    if (!known && !supportsCustomModels(config)) {
      logger.warn(
        `deployment.json: ${where}.models.default.name ` +
          `"${defaultOverride.name}" is not in the known model list ` +
          `(see docs/deployment-config.md) — applying anyway`,
      )
    }
  }
  if (defaultOverride?.device && config?.availableDevices?.length) {
    const device = defaultOverride.device.toUpperCase()
    const known = config.availableDevices.some(
      (d) => d.toUpperCase() === device,
    )
    if (!known) {
      logger.warn(
        `deployment.json: ${where}.models.default.device ` +
          `"${defaultOverride.device}" is not in [${config.availableDevices.join(', ')}] ` +
          `— applying anyway`,
      )
    }
  }

  return true
}

type InstanceBase = Pick<
  Service,
  'models' | 'healthCheck' | 'engine' | 'metadata'
>

/**
 * The row fields to write for one instance's settings, merged over `base`: the row itself, or for a
 * new instance the first instance's row (or the service's seed).
 */
function buildInstanceData(
  serviceType: Service['type'],
  base: InstanceBase,
  settings: InstanceSettings,
  where: string,
): Partial<Service> {
  const data: Partial<Service> = {}

  // A worker answers its own /healthcheck, an engine (multiserve) the backend's.
  const engine = selectableEngines(serviceType).find(
    (e) => e === settings.engine,
  )
  const targetEngine = engine ?? base.engine

  if (settings.models) {
    data.models = mergeModels(base.models, settings.models, where)

    const backend = data.models.default?.backend
    const backendHealthCheck =
      backend && targetEngine !== 'worker'
        ? getBackendByValue(backend)?.healthcheck
        : undefined
    if (
      backendHealthCheck &&
      JSON.stringify(backendHealthCheck) !== JSON.stringify(base.healthCheck)
    ) {
      data.healthCheck = backendHealthCheck
      logger.log(
        `🛠️  deployment.json: switching ${where} health check to the ` +
          `"${backend}" backend`,
      )
    }
  }
  if (engine) {
    data.engine = engine
    if (engine === 'worker' && base.engine !== 'worker') {
      data.healthCheck =
        metaMap[serviceType].healthCheck ?? DEFAULT_WORKER_HEALTH_CHECK
    }
  }
  if (settings.metadata) {
    data.metadata = mergeServiceMetadata(base.metadata, settings.metadata)
  }

  return data
}

interface DeclaredInstance extends DeploymentEntry {
  settings: InstanceSettings
}

/**
 * Both forms of a `services.<type>` entry as the instances they declare, first first. Keyed-form
 * `instances` ids are validated later (`usableExtras`).
 */
function splitServiceOverride(
  type: string,
  override: ServiceOverride,
): {
  form: 'list' | 'keyed'
  first: DeclaredInstance
  /** An older file's `port`, which is ignored. */
  port?: number
  extras: DeclaredInstance[]
  extrasWhere: string
} {
  if (Array.isArray(override)) {
    const [first, ...rest] = override.map(
      ({ instanceId, ...settings }, i): DeclaredInstance => ({
        where: `services.${type}[${i}]`,
        label: settings.label,
        instanceId,
        settings,
      }),
    )
    return {
      form: 'list',
      first,
      extras: rest,
      extrasWhere: `services.${type}[1…]`,
    }
  }
  const { instances, port, ...settings } = override
  return {
    form: 'keyed',
    first: { where: `services.${type}`, label: settings.label, settings },
    port,
    extras: Object.entries(instances ?? {}).map(([key, extra]) => ({
      where: `services.${type}.instances.${key}`,
      label: extra.label,
      instanceId: key.trim().toLowerCase(),
      settings: extra,
    })),
    extrasWhere: `services.${type}.instances`,
  }
}

/**
 * Entries after the first that can name an instance: a list entry needs a label, a keyed entry a
 * valid id. The rest are ignored with a warning.
 */
function usableExtras(
  form: 'list' | 'keyed',
  extras: readonly DeclaredInstance[],
): DeclaredInstance[] {
  return extras.filter(({ where, label, instanceId }) => {
    if (form === 'list' && !label) {
      logger.warn(
        `deployment.json: ${where} is ignored — every instance after the ` +
          `first needs a label`,
      )
      return false
    }
    if (instanceId !== undefined && !isValidInstanceId(instanceId)) {
      logger.warn(
        `deployment.json: ${where} is ignored — an instance id is 1–32 ` +
          `lowercase letters, digits or dashes, starting and ending with a letter or digit`,
      )
      return false
    }
    return true
  })
}

/** Deletes an instance the file does not declare; returns whether it was deleted. */
async function deleteUndeclaredInstance(
  payload: BasePayload,
  row: Service,
): Promise<boolean> {
  try {
    // The afterDelete hook stops its process and removes its data directory.
    await payload.delete({ collection: 'services', id: row.id })
    logger.log(
      `🗑️  deployment.json: deleted ${row.type} instance "${row.instanceId}" — not in the file`,
    )
    return true
  } catch (error) {
    logger.error(
      `deployment.json: failed to delete ${row.type} instance "${row.instanceId}":`,
      error,
    )
    return false
  }
}

/** Deletes every instance of each service the file does not list (a service is only its rows). */
async function removeUnlistedServices(
  payload: BasePayload,
  listed: ReadonlySet<string>,
): Promise<void> {
  for (const type of Object.keys(metaMap)) {
    if (listed.has(type)) continue
    const rows = (
      await payload.find({
        collection: 'services',
        where: { type: { equals: type } },
        sort: 'id',
        limit: MAX_ROWS_PER_TYPE,
      })
    ).docs
    for (const row of rows) await deleteUndeclaredInstance(payload, row)
    if (rows.length > 0) {
      logger.log(`🗑️  deployment.json: removed ${type} — not in the file`)
    }
  }
}

/** The type's instances while a file is applied, kept current as rows change. */
type LiveRows = Map<number, Service>

/**
 * Applies an entry's presets to its matched instance in place; a different `label` renames it (the
 * id stays). Returns the row, or undefined when the update failed.
 */
async function applyToExisting(
  payload: BasePayload,
  serviceType: Service['type'],
  entry: DeclaredInstance,
  match: Extract<EntryMatch<Service>, { kind: 'existing' }>,
  live: LiveRows,
): Promise<Service | undefined> {
  const { where, settings, instanceId } = entry
  const { row } = match
  if (instanceId !== undefined && instanceId !== row.instanceId) {
    logger.log(
      `🛠️  deployment.json: there is no ${serviceType} instance "${instanceId}" — ` +
        `${where} configures ${getInstanceKey(row)} instead (` +
        `${match.by === 'label' ? 'same name' : 'the first instance'}), ` +
        `which keeps its address`,
    )
  }
  const data = buildInstanceData(serviceType, row, settings, where)
  if (settings.label && settings.label !== getInstanceLabel(row)) {
    const others = [...live.values()].filter((d) => d.id !== row.id)
    if (findInstanceWithLabel(settings.label, others)) {
      logger.warn(
        `deployment.json: ${where}.label is ignored — ` +
          duplicateInstanceLabelMessage(settings.label),
      )
    } else {
      data.label = settings.label
    }
  }
  if (Object.keys(data).length === 0) return row

  try {
    // Status is unchanged here, so the afterChange hook is a no-op.
    const updated = await payload.update({
      collection: 'services',
      id: row.id,
      data,
    })
    live.set(updated.id, updated)
    if (data.label) {
      logger.log(
        `✏️  deployment.json: ${getInstanceKey(row)} renamed to “${data.label}” — its address stays`,
      )
    }
    logger.log(`🛠️  Applied deployment preset for ${where}`)
    return updated
  } catch (error) {
    logger.error(
      `deployment.json: failed to apply preset for "${where}":`,
      error,
    )
    return undefined
  }
}

/**
 * A new instance's id: the entry's own, else one derived from its name that is neither taken nor in
 * `reservedIds`. Undefined (with a warning) when the entry's id is already taken.
 */
function newInstanceId(
  entry: DeclaredInstance,
  label: string,
  live: LiveRows,
  reservedIds: ReadonlySet<string>,
  firstWhere: string,
  firstDoc?: Service,
): string | undefined {
  const taken = [...live.values()].map((d) => d.instanceId)
  if (entry.instanceId === undefined) {
    return uniqueInstanceId(label, [...taken, ...reservedIds])
  }
  if (!taken.includes(entry.instanceId)) return entry.instanceId
  logger.warn(
    `deployment.json: ${entry.where} is ignored — ` +
      (entry.instanceId === firstDoc?.instanceId
        ? `"${entry.instanceId}" is the service's first instance, configured by the fields of ${firstWhere} itself`
        : `an earlier entry already created instance "${entry.instanceId}"`),
  )
  return undefined
}

/** Whether the type may get another instance; warns when it may not. */
function hasRoomForInstance(
  serviceType: Service['type'],
  where: string,
  live: LiveRows,
): boolean {
  const meta = metaMap[serviceType]
  const max = meta.maxInstances ?? DEFAULT_MAX_INSTANCES
  if (live.size < max) return true
  logger.warn(
    `deployment.json: ${where} is not created — ${meta.name} already ` +
      `has the maximum of ${max} instances`,
  )
  return false
}

/** Creates the first instance, stopped, from the service's defaults with the entry's presets on top. */
async function createFirstInstance(
  payload: BasePayload,
  serviceType: Service['type'],
  entry: DeclaredInstance,
  live: LiveRows,
  reservedIds: ReadonlySet<string>,
): Promise<Service | undefined> {
  const meta = metaMap[serviceType]
  const { where, settings } = entry
  if (!hasRoomForInstance(serviceType, where, live)) return undefined
  const label =
    settings.label ??
    uniqueInstanceLabel(meta.name, [...live.values()].map(getInstanceLabel))
  if (findInstanceWithLabel(label, [...live.values()])) {
    logger.warn(
      `deployment.json: ${where} is not created — ` +
        duplicateInstanceLabelMessage(label),
    )
    return undefined
  }
  const instanceId = newInstanceId(entry, label, live, reservedIds, where)
  if (instanceId === undefined) return undefined

  const seed = seedInstanceSettings(serviceType, serverOS())
  const data = buildInstanceData(
    serviceType,
    { ...seed, metadata: undefined },
    settings,
    where,
  )
  try {
    const created = await payload.create({
      collection: 'services',
      data: {
        name: meta.name,
        type: serviceType,
        instanceId,
        label,
        port: null,
        engine: data.engine ?? seed.engine,
        models: data.models ?? seed.models,
        healthCheck: data.healthCheck ?? seed.healthCheck,
        metadata: data.metadata,
        status: 'inactive',
      },
    })
    live.set(created.id, created)
    logger.log(`📦 deployment.json: added ${meta.name} as "${label}"`)
    return created
  } catch (error) {
    logger.error(`deployment.json: failed to add ${serviceType}:`, error)
    return undefined
  }
}

/** Creates a later instance, stopped, as a copy of `firstDoc` with the entry's overrides on top. */
async function createExtraInstance(
  payload: BasePayload,
  serviceType: Service['type'],
  entry: DeclaredInstance,
  firstDoc: Service,
  firstWhere: string,
  live: LiveRows,
  reservedIds: ReadonlySet<string>,
): Promise<Service | undefined> {
  const meta = metaMap[serviceType]
  const { where, settings } = entry
  // A keyed-form entry is named after its id unless it says otherwise.
  const label = settings.label ?? entry.instanceId
  if (!label) return undefined

  const instanceId = newInstanceId(
    entry,
    label,
    live,
    reservedIds,
    firstWhere,
    firstDoc,
  )
  if (instanceId === undefined) return undefined
  if (!hasRoomForInstance(serviceType, where, live)) return undefined
  if (findInstanceWithLabel(label, [...live.values()])) {
    logger.warn(
      `deployment.json: ${where} is not created — ` +
        duplicateInstanceLabelMessage(label),
    )
    return undefined
  }

  const data = buildInstanceData(serviceType, firstDoc, settings, where)
  try {
    const created = await payload.create({
      collection: 'services',
      data: {
        name: firstDoc.name,
        type: serviceType,
        instanceId,
        label,
        port: null,
        engine: data.engine ?? firstDoc.engine,
        models: data.models ?? firstDoc.models,
        healthCheck: data.healthCheck ?? firstDoc.healthCheck,
        metadata: data.metadata ?? firstDoc.metadata ?? undefined,
        status: 'inactive',
      },
    })
    live.set(created.id, created)
    logger.log(
      `📦 deployment.json: created ${meta.name} instance "${instanceId}"`,
    )
    return created
  } catch (error) {
    logger.error(
      `deployment.json: failed to create instance "${where}":`,
      error,
    )
    return undefined
  }
}

/**
 * Makes one service match its entry: deletes unmatched instances, applies presets (renames
 * included) before creating any, so a new instance may take a name an existing one gives up.
 * Returns the row ids to auto-start, or undefined when the first entry could not be applied.
 */
async function applyServiceEntry(
  payload: BasePayload,
  serviceType: Service['type'],
  override: ServiceOverride,
): Promise<number[] | undefined> {
  const meta = metaMap[serviceType]
  const { form, first, port, extras, extrasWhere } = splitServiceOverride(
    serviceType,
    override,
  )
  if (!validateSettings(serviceType, first.settings, first.where)) {
    return undefined
  }
  if (port !== undefined) {
    logger.warn(
      `deployment.json: services.${serviceType}.port is ignored — ports are ` +
        `allocated from INSTANCE_PORT_RANGE when a service starts`,
    )
  }
  let declaredExtras: DeclaredInstance[] = []
  if (extras.length > 0 && !meta.multiInstance) {
    logger.warn(
      `deployment.json: ${extrasWhere} is ignored — ` +
        `${meta.name} runs as a single instance`,
    )
  } else {
    declaredExtras = usableExtras(form, extras)
  }

  const rows = (
    await payload.find({
      collection: 'services',
      where: { type: { equals: serviceType } },
      sort: 'id',
      limit: MAX_ROWS_PER_TYPE,
    })
  ).docs
  const entries = [first, ...declaredExtras]
  const { matches, undeclared } = matchDeploymentEntries(entries, rows, form)
  const gone = new Set<number>()
  for (const row of undeclared) {
    if (await deleteUndeclaredInstance(payload, row)) gone.add(row.id)
  }
  const live: LiveRows = new Map(
    rows.filter((r) => !gone.has(r.id)).map((r) => [r.id, r]),
  )
  // Only the list form reserves ids: in the keyed form an `instances.<id>` naming the first
  // instance's id is that instance.
  const reservedIds = new Set(
    form === 'list'
      ? matches.flatMap((m) =>
          m.kind === 'new' && m.instanceId !== undefined ? [m.instanceId] : [],
        )
      : [],
  )

  const applied: (Service | undefined)[] = entries.map(() => undefined)
  for (const [i, entry] of entries.entries()) {
    const match = matches[i]
    if (match.kind === 'skip') {
      logger.warn(
        `deployment.json: ${entry.where} is ignored — ${match.reason}`,
      )
      continue
    }
    if (match.kind !== 'existing') continue
    if (i === 0) {
      applied[0] = await applyToExisting(
        payload,
        serviceType,
        entry,
        match,
        live,
      )
      if (!applied[0]) return undefined
    } else if (validateSettings(serviceType, entry.settings, entry.where)) {
      applied[i] = await applyToExisting(
        payload,
        serviceType,
        entry,
        match,
        live,
      )
    }
  }

  if (!applied[0]) {
    applied[0] = await createFirstInstance(
      payload,
      serviceType,
      first,
      live,
      reservedIds,
    )
  }
  const firstDoc = applied[0]
  if (!firstDoc) return undefined
  for (const [i, entry] of entries.entries()) {
    if (i === 0 || matches[i].kind !== 'new') continue
    if (!validateSettings(serviceType, entry.settings, entry.where)) continue
    applied[i] = await createExtraInstance(
      payload,
      serviceType,
      entry,
      firstDoc,
      first.where,
      live,
      reservedIds,
    )
  }

  return entries.flatMap((entry, i) => {
    const doc = applied[i]
    return doc && entry.settings.status === 'online' ? [doc.id] : []
  })
}

/**
 * Makes the service rows match deployment.json, the whole setup: listed services get exactly the
 * listed instances, everything else is removed. An invalid file changes nothing. Must run after
 * syncServiceRows() and inactivateServices(), so the 'prepare' change fires the start hook.
 */
export async function applyDeploymentConfig(
  payload: BasePayload,
): Promise<void> {
  const loaded = loadDeploymentConfig()
  if (!loaded) return

  const { config, filePath } = loaded
  logger.log(`🛠️  Applying deployment presets from ${filePath}`)
  const autostart = new Map<string, number[]>()

  for (const [type, override] of Object.entries(config.services)) {
    if (!isServiceType(type)) {
      logger.warn(
        `deployment.json: unknown service type "${type}" — valid types: ` +
          `${Object.keys(metaMap).join(', ')}`,
      )
      continue
    }
    const meta = metaMap[type]
    if (hasExecutionMode(meta.execution, 'none')) {
      logger.warn(
        `deployment.json: services.${type} is ignored — ${meta.name} runs ` +
          `inside the studio and has no instances`,
      )
      continue
    }
    const ids = await applyServiceEntry(payload, type, override)
    if (ids && ids.length > 0) autostart.set(type, ids)
  }

  await removeUnlistedServices(payload, new Set(Object.keys(config.services)))

  // Not awaited: this runs in onInit, and the start hook calls getPayload(), which resolves only
  // after onInit returns (deadlock). Instances of one type start serially (simultaneous starts
  // can interfere with each other's engine start-up); different types start in parallel.
  for (const [type, ids] of autostart) {
    void (async () => {
      for (const id of ids) {
        logger.log(`🛠️  deployment.json: auto-starting ${type} (#${id})`)
        try {
          await payload.update({
            collection: 'services',
            id,
            data: { status: 'prepare', statusMessage: '' },
          })
          await waitForInstanceToSettle(payload, id)
        } catch (error) {
          logger.error(
            `deployment.json: failed to auto-start "${type}":`,
            error,
          )
        }
      }
    })()
  }
}

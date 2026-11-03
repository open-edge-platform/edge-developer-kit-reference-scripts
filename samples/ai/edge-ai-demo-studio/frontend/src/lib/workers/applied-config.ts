// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * In-memory record of what each running instance was started with, served as `applied` on
 * `GET /api/services` rows so "Restart to apply" never depends on which browser tab saved.
 */

import { globalSingleton } from '@/lib/global-singleton'
import type {
  AppliedConfig,
  AppliedDifference,
} from '@/lib/instances/runtime-fields'
import { metadataFieldsFor } from '@/lib/instances/service-metadata'
import { isRunningPayloadStatus } from '@/lib/instances/service-status'
import type { Service } from '@/payload-types'

/** What a start captured, before it is compared with the saved row. */
type StartedWith = Omit<AppliedConfig, 'unapplied'>

/** Metadata only the browser reads (frame-generation default, lipsync client ICE server): no restart. */
const BROWSER_ONLY_METADATA = new Set(['clientIceServerUrl', 'frameGeneration'])

/** The model fields compared, as `AppliedConfig` names them. */
const MODEL_FIELDS = [
  ['model', 'name'],
  ['device', 'device'],
  ['backend', 'backend'],
  ['quant', 'quant'],
  ['source', 'source'],
  ['params', 'params'],
  ['modelType', 'type'],
] as const

/**
 * Keyed by row id, which a rename keeps. On `globalThis` because dev loads
 * the lifecycle module and the services route as separate copies.
 */
const startedWith = globalSingleton(
  'instanceAppliedConfig',
  () => new Map<number, StartedWith>(),
)

/** Records what `service` is being started with; call once its start is under way. */
export function recordAppliedConfig(service: Service): void {
  const model = service.models?.default
  startedWith.set(service.id, {
    startedAt: new Date().toISOString(),
    model: model?.name,
    device: model?.device,
    backend: model?.backend,
    quant: model?.quant,
    source: model?.source,
    params: model?.params,
    modelType: model?.type,
    engine: service.engine,
    metadata: { ...service.metadata },
  })
}

/** Forgets what an instance was started with: its process is stopping. */
export function forgetAppliedConfig(service: Pick<Service, 'id'>): void {
  startedWith.delete(service.id)
}

/** A setting as text for comparing and showing; unset and empty are one. */
function settingText(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/** Metadata as the worker sees it: no browser-only keys, and a missing key reads as its default. */
function effectiveMetadata(
  type: Service['type'],
  metadata: Record<string, unknown> | null | undefined,
): Map<string, string | null> {
  const fields = metadataFieldsFor(type)
  const keys = new Set([...Object.keys(fields), ...Object.keys(metadata ?? {})])
  const effective = new Map<string, string | null>()
  for (const key of keys) {
    if (BROWSER_ONLY_METADATA.has(key)) continue
    effective.set(key, settingText(metadata?.[key] ?? fields[key]?.default))
  }
  return effective
}

/** The saved settings of `row` that the run `applied` does not use. */
function unappliedSettings(
  row: Service,
  applied: StartedWith,
): AppliedDifference[] {
  const differences: AppliedDifference[] = []
  const saved = row.models?.default
  for (const [key, field] of MODEL_FIELDS) {
    const running = settingText(applied[key])
    const now = settingText(saved?.[field])
    // Devices are named case-insensitively everywhere ("gpu" is "GPU").
    const same =
      key === 'device'
        ? running?.toLowerCase() === now?.toLowerCase()
        : running === now
    if (!same) differences.push({ key, running, saved: now })
  }
  if (applied.engine !== row.engine) {
    differences.push({
      key: 'engine',
      running: settingText(applied.engine),
      saved: settingText(row.engine),
    })
  }
  const runningMetadata = effectiveMetadata(row.type, applied.metadata)
  const savedMetadata = effectiveMetadata(row.type, row.metadata)
  for (const key of new Set([
    ...runningMetadata.keys(),
    ...savedMetadata.keys(),
  ])) {
    const running = runningMetadata.get(key) ?? null
    const now = savedMetadata.get(key) ?? null
    if (running !== now) {
      differences.push({ key: `metadata.${key}`, running, saved: now })
    }
  }
  return differences
}

/**
 * What the process of `row` runs with and which saved settings it does not
 * use yet; `null` when nothing runs for it (or the app did not start it).
 */
export function appliedConfigOf(row: Service): AppliedConfig | null {
  const applied = startedWith.get(row.id)
  if (!applied || !isRunningPayloadStatus(row.status)) return null
  return { ...applied, unapplied: unappliedSettings(row, applied) }
}

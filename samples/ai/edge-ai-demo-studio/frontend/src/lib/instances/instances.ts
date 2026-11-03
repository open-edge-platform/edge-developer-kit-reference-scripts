// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Pure helpers for service instances. Each is addressed by `<type>@<instanceId>` everywhere (process,
 * logs, data, `/api/` address); the id is derived from the name at creation and never changes.
 */

export const INSTANCE_PORT_RANGE = { start: 8100, end: 8199 } as const

/** Cap on instances per service type when `maxInstances` is unset. */
export const DEFAULT_MAX_INSTANCES = 5

/** 1–32 lowercase letters, digits or dashes, starting and ending with a letter or digit. */
export const INSTANCE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/
const MAX_INSTANCE_ID_LENGTH = 32

const INSTANCE_KEY_SEPARATOR = '@'

export interface InstanceRef {
  type: string
  instanceId: string
}

/**
 * The instance a caller gets when it names only a type: the best-ranked by `preference` (lower
 * first), ties going to the earliest. `rows` must be in creation order.
 */
export function pickPrimaryInstance<T>(
  rows: readonly T[],
  preference: (row: T) => number,
): T | undefined {
  let best: T | undefined
  let bestRank = Number.POSITIVE_INFINITY
  for (const row of rows) {
    const rank = preference(row)
    if (rank < bestRank) {
      best = row
      bestRank = rank
    }
  }
  return best
}

/** `type@instanceId`. */
export function getInstanceKey(ref: InstanceRef): string {
  return `${ref.type}${INSTANCE_KEY_SEPARATOR}${ref.instanceId}`
}

/**
 * Id of a type's row-less draft multiserve engine, for managing models before an instance exists.
 * The underscore keeps it outside `INSTANCE_ID_PATTERN`, so no real instance can take it.
 */
export const DRAFT_ENGINE_INSTANCE_ID = '_draft'

/** `type@_draft`, reachable at `/api/<key>/…`. */
export function getDraftEngineKey(type: string): string {
  return getInstanceKey({ type, instanceId: DRAFT_ENGINE_INSTANCE_ID })
}

/** `null` for anything that is not `type@instanceId` (a bare type names a service). */
export function parseInstanceKey(
  key: string,
): { type: string; instanceId: string } | null {
  const idx = key.indexOf(INSTANCE_KEY_SEPARATOR)
  if (idx <= 0) return null
  const instanceId = key.slice(idx + 1)
  if (!instanceId) return null
  return { type: key.slice(0, idx), instanceId }
}

/** Base URL (path only) that reaches the instance's worker through the app. */
export function getInstanceApiBase(ref: InstanceRef): string {
  return `/api/${getInstanceKey(ref)}`
}

/** Process / log-file name of an instance. */
export function getInstanceProcessName(ref: InstanceRef): string {
  return getInstanceKey(ref)
}

export function getInstanceLabel(ref: {
  label?: string | null
  instanceId?: string | null
}): string {
  if (ref.label?.trim()) return ref.label.trim()
  return ref.instanceId ?? 'Instance'
}

function slugifyInstanceId(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_INSTANCE_ID_LENGTH)
    .replace(/-+$/g, '')
}

export function isValidInstanceId(id: string): boolean {
  return INSTANCE_ID_PATTERN.test(id)
}

/** A new instance's id, derived from `label`; a clash with `takenIds` gets a numeric suffix. */
export function uniqueInstanceId(
  label: string,
  takenIds: Iterable<string>,
): string {
  const taken = new Set(takenIds)
  const base = slugifyInstanceId(label) || 'instance'
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const head = base
      .slice(0, MAX_INSTANCE_ID_LENGTH - suffix.length)
      .replace(/-+$/g, '')
    const candidate = `${head}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Instance names are unique per type, compared trimmed and case-insensitively. */
function labelKey(label: string): string {
  return label.trim().toLowerCase()
}

/** The sibling already called `label`. Never pass the instance being named: it clashes with itself. */
export function findInstanceWithLabel<
  T extends Parameters<typeof getInstanceLabel>[0],
>(label: string, siblings: readonly T[]): T | undefined {
  const key = labelKey(label)
  if (!key) return undefined
  return siblings.find((s) => labelKey(getInstanceLabel(s)) === key)
}

export function duplicateInstanceLabelMessage(label: string): string {
  return `An instance named “${label.trim()}” already exists. Choose another name.`
}

/** First "<base>", "<base> 2", "<base> 3"… not already used as a label. */
export function uniqueInstanceLabel(
  base: string,
  takenLabels: Iterable<string>,
): string {
  const taken = new Set([...takenLabels].map(labelKey))
  if (!taken.has(labelKey(base))) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`
    if (!taken.has(labelKey(candidate))) return candidate
  }
}

/** All ports an instance occupies: its base port plus engine sub-ports. */
export function getInstancePortBlock(
  basePort: number,
  subPorts: number[] = [],
): number[] {
  return [basePort, ...subPorts]
}

/**
 * An instance's API path to hand a sibling worker, resolved against the app's URL: calls go through
 * the proxy (counted in metrics) and survive the sibling restarting on another port.
 */
export function siblingWorkerAddress(
  instanceKey: string,
  suffix = '/v1',
): string {
  return `/api/${instanceKey}${suffix}`
}

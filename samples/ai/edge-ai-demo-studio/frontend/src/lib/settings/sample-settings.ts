// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Which instance a sample uses per service type: `{ [sampleId]: { [type]: <services row id> } }`,
 * in the `sample-settings` global. A type without an entry uses its primary instance. Pure and
 * import-free: Payload config and browser code both import it.
 */

/** Sample ids are folder names. */
const SAMPLE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

export type SampleInstanceBindings = Record<string, Record<string, number>>

export function isValidSampleId(id: unknown): id is string {
  return typeof id === 'string' && SAMPLE_ID_PATTERN.test(id)
}

export function isServiceRowId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** Everything in `raw` that has the `{ sampleId: { type: rowId } }` shape. */
export function normalizeSampleInstanceBindings(
  raw: unknown,
): SampleInstanceBindings {
  const result: SampleInstanceBindings = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result
  for (const [sampleId, perType] of Object.entries(raw)) {
    if (!isValidSampleId(sampleId)) continue
    if (!perType || typeof perType !== 'object' || Array.isArray(perType)) {
      continue
    }
    const entries = Object.entries(perType).filter(
      (entry): entry is [string, number] =>
        entry[0].length > 0 && isServiceRowId(entry[1]),
    )
    if (entries.length === 0) continue
    result[sampleId] = Object.fromEntries(entries)
  }
  return result
}

/** Sets (or, for null, removes) a binding without mutating; a sample left empty is dropped. */
export function withSampleInstanceBinding(
  bindings: SampleInstanceBindings,
  sampleId: string,
  type: string,
  rowId: number | null,
): SampleInstanceBindings {
  const perType = { ...(bindings[sampleId] ?? {}) }
  if (rowId == null) delete perType[type]
  else perType[type] = rowId

  const next = { ...bindings }
  if (Object.keys(perType).length > 0) next[sampleId] = perType
  else delete next[sampleId]
  return next
}

/** Drops every entry pointing at `rowId`; returns the same object when none did, to skip the write. */
export function withoutServiceRow(
  bindings: SampleInstanceBindings,
  rowId: number,
): SampleInstanceBindings {
  let next = bindings
  for (const [sampleId, perType] of Object.entries(bindings)) {
    for (const [type, id] of Object.entries(perType)) {
      if (id === rowId)
        next = withSampleInstanceBinding(next, sampleId, type, null)
    }
  }
  return next
}

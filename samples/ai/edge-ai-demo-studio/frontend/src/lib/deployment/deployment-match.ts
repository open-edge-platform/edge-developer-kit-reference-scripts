// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Which existing instance each deployment.json entry configures. List entries match by `instanceId`,
 * then `label` (ignoring case); an unmatched first entry takes the oldest unclaimed instance, so a
 * new name renames it. Other unmatched entries are created; unclaimed instances are deleted. In the
 * keyed form the top-level fields are the first instance and `instances.<id>` match by id alone.
 */

import { findInstanceWithLabel } from '@/lib/instances/instances'

export interface DeploymentEntry {
  /** Where the entry sits in the file, for messages (`services.<type>[1]`). */
  where: string
  label?: string
  /** Validated and lower-cased: a list entry's `instanceId`, or a keyed-form `instances` key. */
  instanceId?: string
}

export interface MatchableRow {
  id: number
  instanceId: string
  label?: string | null
}

export type EntryMatch<R> =
  | { kind: 'existing'; row: R; by: 'instanceId' | 'label' | 'first' }
  | { kind: 'new'; instanceId?: string }
  /** `reason` completes "<where> is ignored — …". */
  | { kind: 'skip'; reason: string }

export interface DeploymentMatch<R> {
  /** One per entry, in entry order. */
  matches: EntryMatch<R>[]
  /** Existing rows no entry claims: the file removes them. */
  undeclared: R[]
}

/** Matches `entries` (first instance first) to the type's `rows` in creation order. */
export function matchDeploymentEntries<R extends MatchableRow>(
  entries: readonly DeploymentEntry[],
  rows: readonly R[],
  form: 'list' | 'keyed',
): DeploymentMatch<R> {
  const matches: (EntryMatch<R> | undefined)[] = entries.map(() => undefined)
  const claimed = new Set<number>()
  const claim = (
    index: number,
    row: R,
    by: 'instanceId' | 'label' | 'first',
  ) => {
    matches[index] = { kind: 'existing', row, by }
    claimed.add(row.id)
  }
  const unclaimed = () => rows.filter((r) => !claimed.has(r.id))

  // The keyed form's top-level fields are its first instance, whatever its id.
  if (form === 'keyed' && entries.length > 0 && rows.length > 0) {
    claim(0, rows[0], 'first')
  }

  // By id: an id names one instance, so a second entry naming it is ignored.
  const namedBy = new Map<string, number>()
  entries.forEach(({ instanceId }, index) => {
    if (matches[index] || instanceId === undefined) return
    const earlier = namedBy.get(instanceId)
    if (earlier !== undefined) {
      matches[index] = {
        kind: 'skip',
        reason: `${entries[earlier].where} already names instance "${instanceId}"`,
      }
      return
    }
    namedBy.set(instanceId, index)
    const row = rows.find((r) => r.instanceId === instanceId)
    if (!row) return
    // Only the keyed form's first instance is claimed before ids are.
    if (claimed.has(row.id)) {
      matches[index] = {
        kind: 'skip',
        reason: `"${instanceId}" is the service's first instance, configured by the fields of ${entries[0].where} itself`,
      }
      return
    }
    claim(index, row, 'instanceId')
  })

  if (form === 'list') {
    // By name, among the instances no id claimed.
    entries.forEach(({ label }, index) => {
      if (matches[index] || !label) return
      const row = findInstanceWithLabel(label, unclaimed())
      if (row) claim(index, row, 'label')
    })
    // The first entry falls back to the oldest instance left.
    const oldest = unclaimed()[0]
    if (entries.length > 0 && !matches[0] && oldest) claim(0, oldest, 'first')
  }

  return {
    matches: entries.map(
      (entry, index) =>
        matches[index] ?? { kind: 'new', instanceId: entry.instanceId },
    ),
    undeclared: unclaimed(),
  }
}

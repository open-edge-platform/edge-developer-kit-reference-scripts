// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** A log view as a text file: the filtered entries, oldest first, under a short header. */

import type { LogEntry } from './log-accumulator'
import type { LevelFilter } from './log-filter-params'
import type { LogRun } from './log-transport'

export interface LogExportContext {
  label: string
  /** `type@instance`, or the service id. */
  instanceKey: string
  run: LogRun
  level: LevelFilter
  /** The source filter's label, `undefined` for all sources. */
  source?: string
  search: string
  /** Entries the view retains before filtering. */
  retained: number
  /** Name each line's source: the view reads several. */
  showSource: boolean
}

/** `text-generation@gpu-chat` → `text-generation-gpu-chat`. */
function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'service'
  )
}

/** `text-generation-gpu-chat-current-run-logs.txt`. */
export function logExportFileName(instanceKey: string, run: LogRun): string {
  return `${slug(instanceKey)}-${run}-run-logs.txt`
}

/** The file's text: a `#` header, then one entry per line (or more). */
export function formatLogExport(
  entries: LogEntry[],
  context: LogExportContext,
  exportedAt: Date = new Date(),
): string {
  const filters = [
    context.level !== 'ALL' && `level ${context.level}`,
    context.source && `source ${context.source}`,
    context.search.trim() && `search "${context.search.trim()}"`,
  ].filter(Boolean)
  const header = [
    `# ${context.label} (${context.instanceKey}) · ${context.run} run`,
    `# Filters: ${filters.length ? filters.join(' · ') : 'none'}`,
    `# ${entries.length} of ${context.retained} entries retained in the view · downloaded ${exportedAt.toISOString()}`,
  ]
  const lines = entries.map((entry) =>
    [
      entry.timestamp,
      entry.level.padEnd(5),
      ...(context.showSource ? [`[${entry.source}]`] : []),
      entry.message,
    ].join(' '),
  )
  return `${[...header, ...lines].join('\n')}\n`
}

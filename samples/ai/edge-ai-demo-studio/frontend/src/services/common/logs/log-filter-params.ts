// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * The Logs tab's level and source filters in the page address (`?level=ERROR&source=worker`), so a
 * failed start can link to its errors and a reload keeps the view.
 */

import type { LogLevel, LogSource } from '@/types/common'
import { logSourceKey } from './log-transport'

export type LevelFilter = 'ALL' | LogLevel

const LEVEL_PARAMS: Record<string, LogLevel> = {
  ERROR: 'ERROR',
  ERR: 'ERROR',
  WARN: 'WARN',
  WARNING: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG',
}

/** `?level=` as a filter (any case, `warning` too); anything else is All. */
export function parseLevelParam(value: string | null): LevelFilter {
  return (value && LEVEL_PARAMS[value.toUpperCase()]) || 'ALL'
}

/** `?source=` aliases: `worker` is the instance's process log, `engine` its engine's log. */
const SOURCE_ALIASES: Record<string, LogSource['type']> = {
  worker: 'service',
  engine: 'engine',
}

/** The key of the source `?source=` names (alias, label, target or key; any case), else `ALL`. */
export function findSourceKey(
  value: string | null,
  sources: LogSource[],
): string {
  if (!value) return 'ALL'
  const wanted = value.toLowerCase()
  const kind = SOURCE_ALIASES[wanted]
  const match = kind
    ? sources.find((s) => s.type === kind)
    : sources.find((s) =>
        [s.label, s.target, logSourceKey(s)].some(
          (name) => name.toLowerCase() === wanted,
        ),
      )
  return match ? logSourceKey(match) : 'ALL'
}

/** How the address names the source with `key`: the alias when it has one. */
export function sourceParam(key: string, sources: LogSource[]): string | null {
  const source = sources.find((s) => logSourceKey(s) === key)
  if (!source) return null
  const alias = Object.keys(SOURCE_ALIASES).find(
    (word) => SOURCE_ALIASES[word] === source.type,
  )
  // The alias names the first source of its kind; any other goes by label.
  return alias && findSourceKey(alias, sources) === key ? alias : source.label
}

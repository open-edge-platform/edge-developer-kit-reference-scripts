// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * A log line's severity, from a worker API's level, a logger's prefix or the process stream, and
 * the prefix stripped where the row's badge already shows it.
 */

import type { ApiLogEntry, LogLevel, LogSource } from '@/types/common'

/**
 * The words loggers write for each level: `shown` are the badge's own words
 * (a leading one is dropped from the message), `aliases` only map to it.
 * `ERR` counts only as `level=err`.
 */
const LEVEL_WORDS: Record<LogLevel, { shown: string[]; aliases: string[] }> = {
  ERROR: { shown: ['ERROR'], aliases: ['CRITICAL', 'FATAL'] },
  WARN: { shown: ['WARNING', 'WARN'], aliases: [] },
  INFO: { shown: ['INFO'], aliases: [] },
  DEBUG: { shown: ['DEBUG'], aliases: ['TRACE'] },
}

const LEVEL_RANK: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

const LEVELS = Object.keys(LEVEL_WORDS) as LogLevel[]

/** The level a word names (`warning` → `WARN`), or null. */
function levelFromName(name: string): LogLevel | null {
  const word = name.toUpperCase()
  if (word === 'ERR') return 'ERROR'
  return (
    LEVELS.find(
      (level) =>
        LEVEL_WORDS[level].shown.includes(word) ||
        LEVEL_WORDS[level].aliases.includes(word),
    ) ?? null
  )
}

const NAMES = LEVELS.flatMap((level) => [
  ...LEVEL_WORDS[level].aliases,
  ...LEVEL_WORDS[level].shown,
]).join('|')

// Only the prefixes loggers write; a level word further into a line is text.
const LEVEL_PREFIXES = [
  // `INFO:     Started server process` (uvicorn), `WARNING:root:…`, `ERROR - …`
  new RegExp(`^\\s*(${NAMES})(?=[\\s:|\\]-]|$)`),
  // `warning: 1 line adds whitespace errors.`
  new RegExp(`^\\s*(${NAMES}):`, 'i'),
  // `[2026-09-15 10:00:00.123][42][serving][warning][server.cpp:117] …` (OVMS)
  new RegExp(`^\\s*(?:\\[[^\\]]*\\]\\s*)*\\[\\s*(${NAMES})\\s*\\]`, 'i'),
  // `2026-09-15 10:00:00,123 - main - WARNING - …`, `… | WARNING | …`
  new RegExp(
    `^\\s*\\d{4}-\\d{2}-\\d{2}[T ][\\d:.,]+Z?\\s*(?:[-|]\\s*)?(?:[\\w.]+\\s*[-|]\\s*)?(${NAMES})\\b`,
  ),
  // `level=warn msg=…`
  new RegExp(`(?:^|\\s)level=["']?(${NAMES}|err)\\b`, 'i'),
]

const TRACEBACK = /^Traceback \(most recent call last\):/

/**
 * The most severe level named at the start of any line: one process write
 * often carries several logger lines (`INFO: …\nERROR: Traceback …`).
 */
function levelFromMessage(message: string): LogLevel | null {
  let found: LogLevel | null = null
  for (const line of message.split('\n', 50)) {
    let level: LogLevel | null = TRACEBACK.test(line) ? 'ERROR' : null
    for (const prefix of LEVEL_PREFIXES) {
      if (level) break
      const match = prefix.exec(line)
      if (match) level = levelFromName(match[1])
    }
    if (level && (!found || LEVEL_RANK[level] > LEVEL_RANK[found])) {
      found = level
    }
    if (found === 'ERROR') break
  }
  return found
}

/**
 * A worker API's own level wins. Process output falls back to the level its
 * message names, then to its stream: Python loggers write INFO to stderr, so
 * the stream alone only decides for lines that name no level.
 */
export function resolveLevel(
  entry: ApiLogEntry,
  kind: LogSource['type'],
): LogLevel {
  if (kind === 'api' && entry.level) {
    return levelFromName(entry.level) ?? 'INFO'
  }
  // `/api/logs` sends a file line's stream as its `level`.
  const stream = kind === 'api' ? entry.type : entry.level
  return (
    levelFromMessage(entry.message ?? '') ??
    (stream === 'error' ? 'ERROR' : 'INFO')
  )
}

/**
 * A leading `INFO:`/`INFO |`/`INFO -`/`[INFO]` (any case) in one of the
 * level's own words, with the indentation before it captured.
 */
export const LEADING_LEVEL: Record<LogLevel, RegExp> = Object.fromEntries(
  LEVELS.map((level) => {
    const words = LEVEL_WORDS[level].shown.join('|')
    return [
      level,
      new RegExp(
        `^([ \\t]*)(?:(?:${words})[ \\t]*[:|-][ \\t]*|\\[(?:${words})\\][ \\t]*)`,
        'i',
      ),
    ]
  }),
) as Record<LogLevel, RegExp>

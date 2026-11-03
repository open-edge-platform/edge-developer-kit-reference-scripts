// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * What a log view has read: each source's latest lines merged in time order, cursors and health.
 * Plain functions, not hooks: the React Compiler lowers `acc.nextId++` in a hook as a pre-increment.
 */

import type { LogLevel, LogSource } from '@/types/common'
import { resolveLevel } from './log-level'
import { withoutPollingEntries } from './log-message'
import {
  type Cursor,
  logSourceKey,
  type SourceNote,
  type SourceResult,
} from './log-transport'

export interface LogEntry {
  /** Arrival order: stable across polls, and later arrivals have higher ids. */
  id: number
  timestamp: string
  level: LogLevel
  message: string
  source: string
  sourceKey: string
}

export interface SourceState {
  key: string
  label: string
  /** When the source last answered, in ms since the epoch. */
  lastSuccessAt: number | null
  /** Message of the latest failed read; cleared by the next answer. */
  error: string | null
  note: SourceNote | null
}

export interface LogSnapshot {
  entries: LogEntry[]
  sources: SourceState[]
  newestId: number
}

export interface Accumulated {
  viewKey: string
  entries: LogEntry[]
  cursors: Map<string, Cursor>
  sources: Map<string, SourceState>
  nextId: number
}

export function emptyAccumulated(viewKey: string, nextId = 1): Accumulated {
  return {
    viewKey,
    entries: [],
    cursors: new Map(),
    sources: new Map(),
    nextId,
  }
}

function timeOf(entry: LogEntry) {
  const time = Date.parse(entry.timestamp)
  return Number.isNaN(time) ? 0 : time
}

function approxSize(entry: LogEntry): number {
  return entry.message.length + entry.timestamp.length + entry.source.length
}

/** Drops the oldest entries to fit `maxBytes` (approximately), always keeping the newest. */
function trimToMaxBytes(entries: LogEntry[], maxBytes: number): LogEntry[] {
  let total = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    const next = total + approxSize(entries[i])
    if (next > maxBytes && i !== entries.length - 1) {
      return entries.slice(i + 1)
    }
    total = next
  }
  return entries
}

/**
 * Folds one round of reads into the accumulator, keeping the latest `maxEntries` within `maxBytes`.
 * Hidden polling is dropped first, so it cannot displace lines worth keeping.
 */
export function applyRound(
  acc: Accumulated,
  sources: LogSource[],
  results: SourceResult[],
  maxEntries: number,
  maxBytes: number,
  hiddenPaths: string[],
): LogSnapshot {
  const now = Date.now()
  let kept = acc.entries
  const added: LogEntry[] = []
  const states = sources.map((src, i) => {
    const key = logSourceKey(src)
    const result = results[i]
    const state: SourceState = {
      key,
      label: src.label,
      lastSuccessAt: acc.sources.get(key)?.lastSuccessAt ?? null,
      error: result.error ?? null,
      note: result.note ?? null,
    }
    if (result.error === undefined && !result.note) {
      state.lastSuccessAt = now
      const page = result.page
      const cursor = acc.cursors.get(key)
      if (page && cursor && page.offset < cursor.offset) {
        // The file shrank (process restarted): restart from its new tail on the next poll.
        kept = kept.filter((e) => e.sourceKey !== key)
        acc.cursors.delete(key)
      } else if (page) {
        acc.cursors.set(key, { offset: page.offset, timestamp: page.timestamp })
        for (const raw of withoutPollingEntries(page.logs, hiddenPaths)) {
          added.push({
            id: acc.nextId,
            timestamp: raw.timestamp,
            level: resolveLevel(raw, src.type),
            message: raw.message ?? '',
            source: src.label,
            sourceKey: key,
          })
          acc.nextId += 1
        }
      }
    }
    acc.sources.set(key, state)
    return state
  })

  if (added.length > 0 || kept !== acc.entries) {
    const merged = [...kept, ...added]
      .sort((a, b) => timeOf(a) - timeOf(b))
      .slice(-maxEntries)
    acc.entries = trimToMaxBytes(merged, maxBytes)
  }
  return { entries: acc.entries, sources: states, newestId: acc.nextId - 1 }
}

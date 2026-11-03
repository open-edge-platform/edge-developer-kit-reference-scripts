// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import type { LogSource } from '@/types/common'
import type { LogEntry } from '../log-accumulator'
import {
  findSourceKey,
  type LevelFilter,
  parseLevelParam,
  sourceParam,
} from '../log-filter-params'
import { logSourceKey } from '../log-transport'

export type { LevelFilter } from '../log-filter-params'

/**
 * Level and source filters kept in the page address (`?level=`, `?source=`), so a link opens the
 * view filtered. The search stays the view's own.
 */
export interface LogFilterAddress {
  level: string | null
  source: string | null
  write: (patch: { level?: string | null; source?: string | null }) => void
}

/** Search, level and source filters over the lines a view retains. */
export interface LogFilters {
  search: string
  setSearch: (search: string) => void
  level: LevelFilter
  setLevel: (level: LevelFilter) => void
  /** A source key, or `ALL`. */
  source: string
  setSource: (key: string) => void
  sourceOptions: { key: string; label: string }[]
  /** Lines per level among those the search and source let through. */
  counts: Record<LevelFilter, number>
  /** Any filter narrows the view. */
  active: boolean
  clear: () => void
}

/** Filters a view's retained lines; level counts ignore the level filter so its menu can show them. */
export function useLogFilters(
  retained: LogEntry[],
  sources: LogSource[],
  address?: LogFilterAddress,
): { entries: LogEntry[]; filters: LogFilters } {
  const [search, setSearch] = useState('')
  const [localLevel, setLocalLevel] = useState<LevelFilter>('ALL')
  const [localSource, setLocalSource] = useState('ALL')
  const level = address ? parseLevelParam(address.level) : localLevel
  const source = address ? findSourceKey(address.source, sources) : localSource
  const setLevel = (next: LevelFilter) => {
    if (address) address.write({ level: next === 'ALL' ? null : next })
    else setLocalLevel(next)
  }
  const setSource = (key: string) => {
    if (address) {
      address.write({
        source: key === 'ALL' ? null : sourceParam(key, sources),
      })
    } else setLocalSource(key)
  }

  const sourceOptions = sources.map((s) => ({
    key: logSourceKey(s),
    label: s.label,
  }))
  const activeSource = sourceOptions.some((s) => s.key === source)
    ? source
    : 'ALL'

  const query = search.trim().toLowerCase()
  const scoped = retained.filter(
    (e) =>
      (activeSource === 'ALL' || e.sourceKey === activeSource) &&
      (!query || e.message.toLowerCase().includes(query)),
  )
  const counts: Record<LevelFilter, number> = {
    ALL: scoped.length,
    ERROR: 0,
    WARN: 0,
    INFO: 0,
    DEBUG: 0,
  }
  for (const e of scoped) counts[e.level]++

  return {
    entries: level === 'ALL' ? scoped : scoped.filter((e) => e.level === level),
    filters: {
      search,
      setSearch,
      level,
      setLevel,
      source: activeSource,
      setSource,
      sourceOptions,
      counts,
      active: query !== '' || level !== 'ALL' || activeSource !== 'ALL',
      clear: () => {
        setSearch('')
        if (address) address.write({ level: null, source: null })
        else {
          setLocalLevel('ALL')
          setLocalSource('ALL')
        }
      },
    },
  }
}

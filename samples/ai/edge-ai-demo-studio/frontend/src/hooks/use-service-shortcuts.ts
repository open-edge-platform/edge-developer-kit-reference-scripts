// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useSyncExternalStore } from 'react'
import { createExternalStore } from '@/lib/browser/external-store'

/**
 * Services and samples the user opened most recently, newest first, in session storage (survives a
 * reload, not a studio restart).
 */

export type RecentVisit =
  | {
      kind: 'service'
      /** Service type. */
      id: string
      /** Absent for the service's first instance. */
      instanceId?: string
      /** Epoch ms. */
      at: number
    }
  | {
      kind: 'sample'
      id: string
      /** The visit was to the sample's demo rather than its page. */
      demo: boolean
      at: number
    }

export type VisitInput =
  | { kind: 'service'; id: string; instanceId?: string }
  | { kind: 'sample'; id: string; demo: boolean }

const STORAGE_KEY = 'edge-ai-studio:recent-work'
const MAX_RECENT = 8
const NO_VISITS: readonly RecentVisit[] = []
const NO_IDS: readonly string[] = []

function isVisit(value: unknown): value is RecentVisit {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || typeof v.at !== 'number') return false
  if (v.kind === 'service') {
    return v.instanceId === undefined || typeof v.instanceId === 'string'
  }
  return v.kind === 'sample' && typeof v.demo === 'boolean'
}

function loadVisits(): readonly RecentVisit[] {
  if (typeof window === 'undefined') return NO_VISITS
  try {
    const parsed: unknown = JSON.parse(
      sessionStorage.getItem(STORAGE_KEY) ?? '[]',
    )
    return Array.isArray(parsed)
      ? parsed.filter(isVisit).slice(0, MAX_RECENT)
      : NO_VISITS
  } catch {
    return NO_VISITS
  }
}

const recentVisits = createExternalStore<readonly RecentVisit[]>(loadVisits())

function saveVisits(visits: readonly RecentVisit[]): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(visits))
  } catch {
    // Storage unavailable (private mode, quota): the list lasts only while the page is open.
  }
}

/** Records a visit at the front, replacing any earlier visit to the same service or sample. */
export function noteWorkVisit(visit: VisitInput): void {
  const now = Date.now()
  recentVisits.set((recent) => {
    const [newest] = recent
    // Same place again (a re-render, a tab switch): keep the list as is.
    if (
      newest &&
      newest.kind === visit.kind &&
      newest.id === visit.id &&
      (visit.kind === 'service'
        ? newest.kind === 'service' && newest.instanceId === visit.instanceId
        : newest.kind === 'sample' && newest.demo === visit.demo)
    ) {
      return recent
    }
    const next = [
      { ...visit, at: now },
      ...recent.filter((v) => !(v.kind === visit.kind && v.id === visit.id)),
    ].slice(0, MAX_RECENT)
    saveVisits(next)
    return next
  })
}

/** Records a visit to a service from the palette, keeping its last instance. */
function noteVisit(serviceId: string): void {
  const earlier = recentVisits
    .get()
    .find((v) => v.kind === 'service' && v.id === serviceId)
  noteWorkVisit({
    kind: 'service',
    id: serviceId,
    instanceId: earlier?.kind === 'service' ? earlier.instanceId : undefined,
  })
}

// Derived once per change of the visits, so the snapshot stays the same object between changes.
let derivedFrom: readonly RecentVisit[] | null = null
let derivedIds: readonly string[] = NO_IDS
function recentServiceIds(): readonly string[] {
  const visits = recentVisits.get()
  if (visits !== derivedFrom) {
    derivedFrom = visits
    derivedIds = visits.flatMap((v) => (v.kind === 'service' ? [v.id] : []))
  }
  return derivedIds
}

/** Everything opened recently, newest first; empty on the server and during hydration. */
export function useRecentWork(): readonly RecentVisit[] {
  return useSyncExternalStore(
    recentVisits.subscribe,
    recentVisits.get,
    () => NO_VISITS,
  )
}

/** The services opened most recently, newest first. */
export function useServiceShortcuts(): {
  recent: readonly string[]
  noteVisit: (serviceId: string) => void
} {
  const recent = useSyncExternalStore(
    recentVisits.subscribe,
    recentServiceIds,
    () => NO_IDS,
  )
  return { recent, noteVisit }
}

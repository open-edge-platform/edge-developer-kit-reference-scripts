// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useSyncExternalStore } from 'react'

/**
 * Where a list page was left (query string and scroll position), in session storage. Links back use
 * the remembered query, and the list restores the scroll only when it opens on that same query.
 */

export interface ListReturnContext {
  /** Query string of the list view, with its leading `?` (or empty). */
  search: string
  /** Vertical scroll position of that view. */
  y: number
}

export interface ListReturn {
  /** The list's own path, e.g. `/services`. */
  path: string
  /** Remembers the current view; only while the list is shown, so a late scroll event can't record the next page. */
  record: () => void
  read: () => ListReturnContext | null
  /** `path` plus the remembered query string. */
  href: () => string
}

function parseContext(raw: string | null): ListReturnContext | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('search' in parsed) ||
      typeof parsed.search !== 'string' ||
      !('y' in parsed) ||
      typeof parsed.y !== 'number'
    ) {
      return null
    }
    return { search: parsed.search, y: parsed.y }
  } catch {
    return null
  }
}

export function createListReturn(storageKey: string, path: string): ListReturn {
  const read = (): ListReturnContext | null => {
    try {
      return parseContext(sessionStorage.getItem(storageKey))
    } catch {
      return null
    }
  }
  const record = () => {
    if (typeof window === 'undefined') return
    if (window.location.pathname !== path) return
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ search: window.location.search, y: window.scrollY }),
      )
    } catch {
      // Storage unavailable (private mode, quota): returning lands on the default view.
    }
  }
  return {
    path,
    record,
    read,
    href: () => `${path}${read()?.search ?? ''}`,
  }
}

const subscribeNever = () => () => {}

/** Href back to the list view the user left; the server renders the plain path. */
export function useListReturnHref(list: ListReturn): string {
  return useSyncExternalStore(subscribeNever, list.href, () => list.path)
}

/** For the list page: once `ready`, restores the remembered scroll and keeps recording this view. */
export function useListReturnContext(list: ListReturn, ready: boolean): void {
  useEffect(() => {
    if (!ready) return
    const saved = list.read()
    if (saved && saved.search === window.location.search && saved.y > 0) {
      window.scrollTo({ top: saved.y, behavior: 'instant' })
    }
    list.record()
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => list.record())
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
    }
  }, [list, ready])
}

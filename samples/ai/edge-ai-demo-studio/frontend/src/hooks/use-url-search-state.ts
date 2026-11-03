// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { type ReadonlyURLSearchParams, useSearchParams } from 'next/navigation'

/** Keys to change: a non-empty string sets one, `null`/`undefined`/`''` removes it. */
export type SearchParamsPatch = Record<string, string | null | undefined>

export interface WriteSearchParamsOptions {
  /** Drop the address's `#fragment` too (e.g. a docs anchor of the old tab). */
  clearHash?: boolean
}

/**
 * Writes query parameters without navigating or adding a history entry. The history state is `null`:
 * `window.history.state` carries Next's marker, which makes Next skip the update.
 */
export function writeSearchParams(
  next: SearchParamsPatch | URLSearchParams,
  { clearHash = false }: WriteSearchParamsOptions = {},
): void {
  const url = new URL(window.location.href)
  if (next instanceof URLSearchParams) {
    url.search = next.toString()
  } else {
    for (const [key, value] of Object.entries(next)) {
      if (value) url.searchParams.set(key, value)
      else url.searchParams.delete(key)
    }
  }
  if (clearHash) url.hash = ''
  if (url.href === window.location.href) return
  window.history.replaceState(null, '', url)
}

/**
 * View state in the URL query: the current params and {@link writeSearchParams}. Needs a
 * `<Suspense>` boundary on statically rendered pages, like `useSearchParams`.
 */
export function useUrlSearchState(): readonly [
  ReadonlyURLSearchParams,
  typeof writeSearchParams,
] {
  return [useSearchParams(), writeSearchParams] as const
}

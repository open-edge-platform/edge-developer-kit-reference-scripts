// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  createListReturn,
  type ListReturnContext,
  useListReturnHref,
} from '@/hooks/use-list-return'
import type { OS } from '@/types/common'

/**
 * Gallery search/filters/sort live in the URL; the scroll position is parked in session storage so
 * "Back to Samples" lands where the user left.
 */

export type SortOption = 'name' | 'services'
export type OSFilter = 'all' | OS

export interface GalleryFilters {
  search: string
  category: string | null
  os: OSFilter
  sort: SortOption
}

export const DEFAULT_GALLERY_FILTERS: GalleryFilters = {
  search: '',
  category: null,
  os: 'all',
  sort: 'name',
}

const SORT_OPTIONS: readonly SortOption[] = ['name', 'services']
const OS_OPTIONS: readonly OSFilter[] = ['all', 'linux', 'windows']

function isOneOf<T extends string>(
  options: readonly T[],
  value: string | null,
): value is T {
  return value != null && (options as readonly string[]).includes(value)
}

/** An OS filter value (from the URL or the select); anything else is the default. */
export function parseOSFilter(value: string | null): OSFilter {
  return isOneOf(OS_OPTIONS, value) ? value : DEFAULT_GALLERY_FILTERS.os
}

/** A sort option (from the URL or the select); anything else is the default. */
export function parseSortOption(value: string | null): SortOption {
  return isOneOf(SORT_OPTIONS, value) ? value : DEFAULT_GALLERY_FILTERS.sort
}

/** Reads the filters from a query string; anything malformed falls back to the default. */
export function parseGalleryFilters(params: {
  get: (name: string) => string | null
}): GalleryFilters {
  return {
    search: params.get('q') ?? '',
    category: params.get('category') || null,
    os: parseOSFilter(params.get('os')),
    sort: parseSortOption(params.get('sort')),
  }
}

/** The query string (with its leading `?`) for a set of filters; empty at the defaults. */
export function serializeGalleryFilters(filters: GalleryFilters): string {
  const params = new URLSearchParams()
  if (filters.search) params.set('q', filters.search)
  if (filters.category) params.set('category', filters.category)
  if (filters.os !== 'all') params.set('os', filters.os)
  if (filters.sort !== DEFAULT_GALLERY_FILTERS.sort)
    params.set('sort', filters.sort)
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function hasActiveGalleryFilters(filters: GalleryFilters): boolean {
  return (
    filters.search !== '' || filters.category != null || filters.os !== 'all'
  )
}

/** True when the query has an unsupported `status` or `sort` param, so callers can normalize the URL. */
export function hasRetiredGalleryParams(params: {
  has: (name: string) => boolean
  get: (name: string) => string | null
}): boolean {
  if (params.has('status')) return true
  const sort = params.get('sort')
  return sort != null && !isOneOf(SORT_OPTIONS, sort)
}

/** The gallery's return context: its query string and scroll position. */
const galleryReturn = createListReturn('samples-gallery:return', '/samples')

export type GalleryReturnContext = ListReturnContext

export function readGalleryReturn(): GalleryReturnContext | null {
  return galleryReturn.read()
}

/** Href back to the gallery view the user left. Client components only. */
export function useGalleryReturnHref(): string {
  return useListReturnHref(galleryReturn)
}

/**
 * Records the current gallery view as the return context. Call on mount (so a directly opened URL is
 * remembered) and right before a card navigation. Browser only.
 */
export function recordGalleryEntry(): void {
  galleryReturn.record()
}

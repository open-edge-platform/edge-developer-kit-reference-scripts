// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Monitor, Search, SlidersHorizontal, X } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { categories, getCategoryLabels, samples } from '@/samples/registry'
import { getOSLabel } from '@/types/common'
import { CountPill } from './count-pill'
import {
  DEFAULT_GALLERY_FILTERS,
  type GalleryFilters,
  type OSFilter,
  parseOSFilter,
  parseSortOption,
  type SortOption,
} from './gallery-state'

const sortLabels: Record<SortOption, string> = {
  name: 'Name',
  services: 'Fewest services',
}

const osFilterLabels: Record<OSFilter, string> = {
  all: 'All OS',
  linux: 'Linux',
  windows: 'Windows',
}

const OS_FILTER_HINT =
  'Browses samples by the platforms they support. It does not change what can run on this device.'

/** The fixed categories first, then any other label a sample declares. */
const CATEGORY_OPTIONS: string[] = [
  ...new Set<string>([
    ...categories,
    ...samples.flatMap((s) => getCategoryLabels(s)),
  ]),
]

interface SampleFiltersProps {
  filters: GalleryFilters
  onChange: (patch: Partial<GalleryFilters>) => void
  onClear: () => void
  hasFilters: boolean
}

/** Gallery search and filters; OS and sort move into a sheet on small screens. */
export function SampleFilters({
  filters,
  onChange,
  onClear,
  hasFilters,
}: SampleFiltersProps) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const sheetOsId = useId()
  const sheetOsHintId = useId()
  const sheetSortId = useId()
  // Describes the inline OS select only while an OS is chosen.
  const osHintId = useId()
  const os = filters.os === 'all' ? null : filters.os

  const secondaryCount =
    (filters.os !== 'all' ? 1 : 0) +
    (filters.sort !== DEFAULT_GALLERY_FILTERS.sort ? 1 : 0)

  const osSelect = (id?: string, describedBy?: string) => (
    <Select
      value={filters.os}
      onValueChange={(v) => onChange({ os: parseOSFilter(v) })}
    >
      <SelectTrigger
        id={id}
        aria-label={id ? undefined : 'Filter by operating system'}
        aria-describedby={describedBy}
        className="bg-muted/30 w-full md:w-[150px]"
      >
        <Monitor className="mr-2 h-3.5 w-3.5" aria-hidden />
        <SelectValue placeholder="Supported OS" />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(osFilterLabels).map(([key, label]) => (
          <SelectItem key={key} value={key}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  const sortSelect = (id?: string) => (
    <Select
      value={filters.sort}
      onValueChange={(v) => onChange({ sort: parseSortOption(v) })}
    >
      <SelectTrigger
        id={id}
        aria-label={id ? undefined : 'Sort samples'}
        className="bg-muted/30 w-full md:w-[160px]"
      >
        <SlidersHorizontal className="mr-2 h-3.5 w-3.5" aria-hidden />
        <span className="text-muted-foreground mr-1 hidden text-xs md:inline">
          Sort:
        </span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(sortLabels).map(([key, label]) => (
          <SelectItem key={key} value={key}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <div className="surface-panel rounded-2xl p-4 sm:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:gap-3">
        <div className="relative min-w-0 flex-1 md:min-w-56">
          <Search
            className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            aria-label="Search samples"
            placeholder="Search samples…"
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
            className="bg-muted/30 border-border pl-9"
          />
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <Select
            value={filters.category ?? 'all'}
            onValueChange={(v) =>
              onChange({ category: v === 'all' ? null : v })
            }
          >
            <SelectTrigger
              aria-label="Filter by category"
              className="bg-muted/30 min-w-0 flex-1 md:w-[180px] md:flex-none"
            >
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORY_OPTIONS.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* A SheetTrigger (not a separate button), so closing the sheet
              restores focus here. */}
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="shrink-0 gap-2 md:hidden"
                aria-label="More filters"
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden />
                Filters
                {secondaryCount > 0 && <CountPill count={secondaryCount} />}
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-2xl">
              <SheetHeader>
                <SheetTitle>Filter samples</SheetTitle>
                <SheetDescription>
                  Narrow the gallery by platform, and choose the order.
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4">
                <div className="space-y-1.5">
                  <Label htmlFor={sheetOsId}>Supported OS</Label>
                  {osSelect(sheetOsId, sheetOsHintId)}
                  <p
                    id={sheetOsHintId}
                    className="text-muted-foreground text-xs"
                  >
                    {OS_FILTER_HINT}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={sheetSortId}>Sort</Label>
                  {sortSelect(sheetSortId)}
                </div>
              </div>
              <SheetFooter className="flex-row justify-end">
                {hasFilters && (
                  <Button variant="ghost" onClick={onClear}>
                    Clear all
                  </Button>
                )}
                <SheetClose asChild>
                  <Button>Done</Button>
                </SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          {osSelect(undefined, os ? osHintId : undefined)}
          {sortSelect()}
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="text-muted-foreground"
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {os && (
        <p
          id={osHintId}
          className="text-muted-foreground mt-2 hidden text-xs md:block"
        >
          Showing samples that support {getOSLabel(os)}. {OS_FILTER_HINT}
        </p>
      )}

      {hasFilters && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">Filters:</span>
          {filters.category && (
            <FilterChip
              label="Remove category filter"
              onRemove={() => onChange({ category: null })}
            >
              {filters.category}
            </FilterChip>
          )}
          {filters.os !== 'all' && (
            <FilterChip
              label="Remove operating system filter"
              onRemove={() => onChange({ os: 'all' })}
            >
              {osFilterLabels[filters.os]}
            </FilterChip>
          )}
          {filters.search && (
            <FilterChip
              label="Clear sample search"
              onRemove={() => onChange({ search: '' })}
            >
              &ldquo;{filters.search}&rdquo;
            </FilterChip>
          )}
        </div>
      )}
    </div>
  )
}

function FilterChip({
  label,
  onRemove,
  children,
}: {
  label: string
  onRemove: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      size="sm"
      variant="secondary"
      className="h-7 max-w-full gap-1 rounded-full pr-2 pl-2.5 text-xs"
      aria-label={label}
      onClick={onRemove}
    >
      <span className="truncate">{children}</span>
      <X className="h-3 w-3 shrink-0" aria-hidden />
    </Button>
  )
}

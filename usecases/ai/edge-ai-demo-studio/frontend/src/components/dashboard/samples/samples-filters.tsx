// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Monitor, Search, SlidersHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { OS } from '@/types/common'
import { categories } from '@/samples/registry'

export type SortOption = 'name' | 'services' | 'readiness'
export type ReadinessFilter = 'all' | 'ready' | 'partial' | 'blocked'
export type OSFilter = 'all' | OS

const sortLabels: Record<SortOption, string> = {
  readiness: 'Readiness',
  name: 'Name',
  services: '# Services',
}

const readinessFilterLabels: Record<ReadinessFilter, string> = {
  all: 'All Statuses',
  ready: 'Ready to launch',
  partial: 'Ready (limited)',
  blocked: 'Setup required',
}

const osFilterLabels: Record<OSFilter, string> = {
  all: 'All OS',
  linux: 'Linux',
  windows: 'Windows',
}

export function SampleFilters({
  search,
  setSearch,
  selectedCategory,
  setSelectedCategory,
  selectedReadiness,
  setSelectedReadiness,
  selectedOS,
  setSelectedOS,
  sort,
  setSort,
  clearFilters,
  hasFilters,
}: {
  search: string
  setSearch: (v: string) => void
  selectedCategory: string | null
  setSelectedCategory: (v: string | null) => void
  selectedReadiness: ReadinessFilter
  setSelectedReadiness: (v: ReadinessFilter) => void
  selectedOS: OSFilter
  setSelectedOS: (v: OSFilter) => void
  sort: SortOption
  setSort: (v: SortOption) => void
  clearFilters: () => void
  hasFilters: boolean
}) {
  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:gap-4">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search samples..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-muted/30 border-border pl-9"
          />
        </div>

        <Select
          value={selectedCategory ?? 'all'}
          onValueChange={(v) => setSelectedCategory(v === 'all' ? null : v)}
        >
          <SelectTrigger className="bg-muted/30 w-full md:w-[180px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={selectedReadiness}
          onValueChange={(v) => setSelectedReadiness(v as ReadinessFilter)}
        >
          <SelectTrigger className="bg-muted/30 w-full md:w-[170px]">
            <SelectValue placeholder="Readiness" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(readinessFilterLabels).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={selectedOS}
          onValueChange={(v) => setSelectedOS(v as OSFilter)}
        >
          <SelectTrigger className="bg-muted/30 w-full md:w-[160px]">
            <Monitor className="mr-2 h-3.5 w-3.5" />
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

        <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
          <SelectTrigger className="bg-muted/30 w-full md:w-[150px]">
            <SlidersHorizontal className="mr-2 h-3.5 w-3.5" />
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

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="text-muted-foreground"
          >
            Clear
          </Button>
        )}
      </div>

      {hasFilters && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">Filters:</span>
          {selectedCategory && (
            <Badge
              variant="secondary"
              className="cursor-pointer text-xs"
              onClick={() => setSelectedCategory(null)}
            >
              {selectedCategory} ×
            </Badge>
          )}
          {selectedReadiness !== 'all' && (
            <Badge
              variant="secondary"
              className="cursor-pointer text-xs"
              onClick={() => setSelectedReadiness('all')}
            >
              {readinessFilterLabels[selectedReadiness]} ×
            </Badge>
          )}
          {selectedOS !== 'all' && (
            <Badge
              variant="secondary"
              className="cursor-pointer text-xs"
              onClick={() => setSelectedOS('all')}
            >
              {osFilterLabels[selectedOS]} ×
            </Badge>
          )}
          {search && (
            <Badge
              variant="secondary"
              className="cursor-pointer text-xs"
              onClick={() => setSearch('')}
            >
              &quot;{search}&quot; ×
            </Badge>
          )}
        </div>
      )}
    </div>
  )
}

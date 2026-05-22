// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { SampleCard } from '@/components/dashboard/samples/sample-card'
import {
  type OSFilter,
  type ReadinessFilter,
  type SortOption,
  SampleFilters,
} from '@/components/dashboard/samples/samples-filters'
import { Button } from '@/components/ui/button'
import { useSystemInfo } from '@/context/system-info-context'
import { getOSLabel } from '@/services/registry'
import {
  getMissingSampleDevices,
  isSampleSupportedOnDevices,
  isSampleSupportedOnOS,
  samples,
} from '@/samples/registry'
import { computeSampleReadiness } from '@/samples/common/util'
import { useServiceStatus } from '@/context/service-status-context'

const readinessOrder = { ready: 0, partial: 1, blocked: 2 }

export default function SamplesPage() {
  const { services } = useServiceStatus()
  const { systemInfo } = useSystemInfo()
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedReadiness, setSelectedReadiness] =
    useState<ReadinessFilter>('all')
  const [selectedOS, setSelectedOS] = useState<OSFilter>('all')
  const [sort, setSort] = useState<SortOption>('readiness')

  const { unsupported } = useMemo(() => {
    if (!systemInfo) return { supported: samples, unsupported: [] }
    const sup = samples.filter(
      (s) =>
        isSampleSupportedOnOS(s, systemInfo.os) &&
        isSampleSupportedOnDevices(s, systemInfo.devices),
    )
    const unsup = samples.filter(
      (s) =>
        !isSampleSupportedOnOS(s, systemInfo.os) ||
        !isSampleSupportedOnDevices(s, systemInfo.devices),
    )
    return { supported: sup, unsupported: unsup }
  }, [systemInfo])

  const filtered = useMemo(() => {
    let result = [...samples]

    // OS filter
    if (selectedOS !== 'all') {
      result = result.filter((s) => isSampleSupportedOnOS(s, selectedOS))
    }

    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q)),
      )
    }

    if (selectedCategory) {
      result = result.filter((s) => s.category === selectedCategory)
    }

    if (selectedReadiness !== 'all') {
      result = result.filter(
        (s) => computeSampleReadiness(s, services) === selectedReadiness,
      )
    }

    const unsupportedIds = new Set(unsupported.map((u) => u.id))
    result.sort((a, b) => {
      // Unsupported always sorted to the end
      const aUnsupported = unsupportedIds.has(a.id) ? 1 : 0
      const bUnsupported = unsupportedIds.has(b.id) ? 1 : 0
      if (aUnsupported !== bUnsupported) return aUnsupported - bUnsupported

      if (sort === 'readiness')
        return (
          readinessOrder[computeSampleReadiness(a, services)] -
          readinessOrder[computeSampleReadiness(b, services)]
        )
      if (sort === 'name') return a.title.localeCompare(b.title)
      return a.dependencies.length - b.dependencies.length
    })

    return result
  }, [
    search,
    selectedCategory,
    selectedReadiness,
    selectedOS,
    sort,
    unsupported,
    services,
  ])

  const clearFilters = () => {
    setSearch('')
    setSelectedCategory(null)
    setSelectedReadiness('all')
    setSelectedOS('all')
    setSort('readiness')
  }

  const hasFilters =
    !!search ||
    !!selectedCategory ||
    selectedReadiness !== 'all' ||
    selectedOS !== 'all'

  const unsupportedIds = new Set(unsupported.map((u) => u.id))

  function getUnsupportedReason(sampleId: string): string | undefined {
    if (!systemInfo) return undefined
    const s = samples.find((u) => u.id === sampleId)
    if (!s) return undefined
    if (!isSampleSupportedOnOS(s, systemInfo.os)) {
      return `Not available on ${getOSLabel(systemInfo.os)}`
    }
    const missing = getMissingSampleDevices(s, systemInfo.devices)
    if (missing.length > 0) {
      return `Requires ${missing.map((d) => d.toUpperCase()).join(', ')} device`
    }
    return undefined
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-foreground text-2xl font-bold">Samples</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Explore interactive demos and sample applications built with Intel
          Edge AI services.
        </p>
      </div>

      <SampleFilters
        search={search}
        setSearch={setSearch}
        selectedCategory={selectedCategory}
        setSelectedCategory={setSelectedCategory}
        selectedReadiness={selectedReadiness}
        setSelectedReadiness={setSelectedReadiness}
        selectedOS={selectedOS}
        setSelectedOS={setSelectedOS}
        sort={sort}
        setSort={setSort}
        clearFilters={clearFilters}
        hasFilters={hasFilters}
      />

      <p className="text-muted-foreground text-sm">
        Showing{' '}
        <span className="text-foreground font-medium">{filtered.length}</span>{' '}
        of {samples.length} sample{samples.length !== 1 && 's'}
      </p>

      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s, i) => (
            <div
              key={s.id}
              className="card-stagger"
              style={{ '--card-index': i } as React.CSSProperties}
            >
              <SampleCard
                sample={s}
                unsupported={unsupportedIds.has(s.id)}
                unsupportedReason={getUnsupportedReason(s.id)}
                currentOS={systemInfo?.os}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state-fade flex flex-col items-center justify-center py-20">
          <div className="bg-muted/40 mb-3 flex h-12 w-12 items-center justify-center rounded-full">
            <Sparkles className="text-muted-foreground h-6 w-6" />
          </div>
          <p className="text-foreground text-lg font-medium">
            No samples found
          </p>
          <p className="text-muted-foreground mt-1 max-w-sm text-center text-sm">
            Try removing a filter or adjusting your search to find what
            you&apos;re looking for.
          </p>
          <div className="mt-4 flex items-center gap-2">
            {selectedReadiness !== 'all' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedReadiness('all')}
              >
                Show all statuses
              </Button>
            )}
            {selectedOS !== 'all' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedOS('all')}
              >
                Show all OS
              </Button>
            )}
            {selectedCategory && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedCategory(null)}
              >
                Remove category
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear all filters
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

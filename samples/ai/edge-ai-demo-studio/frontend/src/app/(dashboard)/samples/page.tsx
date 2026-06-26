// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { CheckSquare, Download, Sparkles, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExportSamplesDialog } from '@/components/dashboard/samples/export-samples-dialog'
import { SampleCard } from '@/components/dashboard/samples/sample-card'
import {
  type OSFilter,
  type ReadinessFilter,
  type SortOption,
  SampleFilters,
} from '@/components/dashboard/samples/samples-filters'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { useSystemInfo } from '@/context/system-info-context'
import { getOSLabel } from '@/services/registry'
import {
  hasCategory,
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

  // Multi-select export
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [exportOpen, setExportOpen] = useState(false)

  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

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
      result = result.filter((s) => hasCategory(s, selectedCategory))
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
    <div className="space-y-6 pb-20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-foreground text-2xl font-bold">Samples</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Explore interactive demos and sample applications built with Intel
            Edge AI services.
          </p>
        </div>
        <Button
          variant={selectionMode ? 'secondary' : 'outline'}
          size="sm"
          aria-pressed={selectionMode}
          className={cn(
            'gap-2 transition-colors',
            selectionMode && 'border-primary/40',
          )}
          onClick={() =>
            selectionMode ? exitSelectionMode() : setSelectionMode(true)
          }
        >
          {selectionMode ? (
            <>
              <X className="h-4 w-4" />
              Cancel selection
            </>
          ) : (
            <>
              <CheckSquare className="text-primary h-4 w-4" />
              Select to export
            </>
          )}
        </Button>
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
                selectable={selectionMode}
                selected={selectedIds.has(s.id)}
                onToggleSelect={toggleSelected}
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

      {/* Selection action bar — portalled to <body> so it stays fixed to the
          viewport regardless of how long the gallery is. */}
      {selectionMode &&
        createPortal(
          <div className="animate-in slide-in-from-bottom-4 fade-in fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 duration-300">
            <div className="glass-card flex items-center gap-1.5 rounded-full border py-1.5 pr-1.5 pl-2 shadow-xl">
              <span className="flex items-center gap-2 px-2.5 text-sm">
                <span
                  className={cn(
                    'flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums transition-colors',
                    selectedIds.size > 0
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {selectedIds.size}
                </span>
                <span className="text-muted-foreground hidden sm:inline">
                  selected
                </span>
              </span>
              {selectedIds.size > 0 && (
                <>
                  <Separator orientation="vertical" className="!h-5" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground rounded-full"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    Clear
                  </Button>
                </>
              )}
              <Button
                size="sm"
                className="gap-2 rounded-full"
                disabled={selectedIds.size === 0}
                onClick={() => setExportOpen(true)}
              >
                <Download className="h-4 w-4" />
                Export selected
              </Button>
            </div>
          </div>,
          document.body,
        )}

      <ExportSamplesDialog
        sampleIds={[...selectedIds]}
        open={exportOpen}
        onOpenChange={setExportOpen}
        onExported={exitSelectionMode}
      />
    </div>
  )
}

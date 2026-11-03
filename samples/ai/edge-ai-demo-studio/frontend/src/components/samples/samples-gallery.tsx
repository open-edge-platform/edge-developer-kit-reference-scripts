// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  CheckSquare,
  Download,
  Loader,
  RefreshCw,
  Sparkles,
  WifiOff,
  X,
} from 'lucide-react'
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { EmptyState } from '@/components/common/empty-state'
import { PageHeading } from '@/components/shell/page-heading'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useSystemInfo } from '@/context/system-info-context'
import {
  useUrlSearchState,
  writeSearchParams,
} from '@/hooks/use-url-search-state'
import { plural } from '@/lib/browser/format'
import { cn } from '@/lib/utils'
import { hasCategory, isSampleSupportedOnOS, samples } from '@/samples/registry'
import type { Sample } from '@/samples/types'
import { CountPill } from './count-pill'
import { ExportBundleDialog } from './export-bundle-dialog'
import {
  DEFAULT_GALLERY_FILTERS,
  type GalleryFilters,
  hasActiveGalleryFilters,
  hasRetiredGalleryParams,
  parseGalleryFilters,
  readGalleryReturn,
  recordGalleryEntry,
  serializeGalleryFilters,
} from './gallery-state'
import { SampleCard } from './sample-card'
import { SampleFilters } from './sample-filters'

/** How long the first-paint stagger can last: cap on delay plus one card's animation. */
const ENTRY_ANIMATION_MS = 500

/** The filtered samples in a deterministic order; no runtime state, so no bindings to resolve. */
function gallerySamples(filters: GalleryFilters): Sample[] {
  const q = filters.search.toLowerCase()
  const { os, category } = filters
  return samples
    .filter(
      (s) =>
        (os === 'all' || isSampleSupportedOnOS(s, os)) &&
        (!q ||
          s.title.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q))) &&
        (!category || hasCategory(s, category)),
    )
    .sort((a, b) => {
      if (filters.sort === 'services') {
        const diff = a.dependencies.length - b.dependencies.length
        if (diff !== 0) return diff
      }
      return a.title.localeCompare(b.title)
    })
}

/** Replaces the query with exactly these filters (nothing at the defaults). */
function writeGalleryFilters(filters: GalleryFilters) {
  writeSearchParams(new URLSearchParams(serializeGalleryFilters(filters)))
}

export function SamplesGallery() {
  const [searchParams] = useUrlSearchState()
  // Unsupported params parse to the defaults, so rendering is normalized
  // before useGalleryReturnContext rewrites the URL.
  const filters = parseGalleryFilters(searchParams)

  // No navigation and no history entry per keystroke.
  const updateFilters = (patch: Partial<GalleryFilters>) => {
    writeGalleryFilters({
      ...parseGalleryFilters(new URLSearchParams(window.location.search)),
      ...patch,
    })
    recordGalleryEntry()
  }
  const clearFilters = () => updateFilters(DEFAULT_GALLERY_FILTERS)

  useGalleryReturnContext()

  // The entrance stagger runs once; cards added later just fade in.
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setEntered(true), ENTRY_ANIMATION_MS)
    return () => window.clearTimeout(id)
  }, [])

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

  const visible = gallerySamples(filters)
  const visibleIds = new Set(visible.map((s) => s.id))
  const hiddenSelected = [...selectedIds].filter((id) => !visibleIds.has(id))

  return (
    <div
      className={cn('space-y-6', selectionMode ? 'pb-36' : 'pb-12')}
      style={
        selectionMode
          ? { paddingBottom: 'calc(9rem + env(safe-area-inset-bottom))' }
          : undefined
      }
    >
      <PageHeading
        title="Samples"
        description="Explore AI samples for your device."
      >
        <Button
          variant={selectionMode ? 'secondary' : 'outline'}
          aria-pressed={selectionMode}
          className={cn('gap-2', selectionMode && 'border-primary/40')}
          onClick={() =>
            selectionMode ? exitSelectionMode() : setSelectionMode(true)
          }
        >
          {selectionMode ? (
            <>
              <X className="h-4 w-4" aria-hidden />
              Cancel selection
            </>
          ) : (
            <>
              <CheckSquare className="text-primary h-4 w-4" aria-hidden />
              Select to export
            </>
          )}
        </Button>
      </PageHeading>

      <SampleFilters
        filters={filters}
        onChange={updateFilters}
        onClear={clearFilters}
        hasFilters={hasActiveGalleryFilters(filters)}
      />

      <GalleryStatusLine shown={visible.length} />

      {visible.length > 0 ? (
        <div
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          onClickCapture={() => recordGalleryEntry()}
        >
          {visible.map((sample, i) => (
            <GalleryCardFrame key={sample.id} index={i} entered={entered}>
              <SampleCard
                sample={sample}
                selectable={selectionMode}
                selected={selectedIds.has(sample.id)}
                onToggleSelect={toggleSelected}
              />
            </GalleryCardFrame>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Sparkles}
          size="sm"
          title="No samples found"
          description="Try removing a filter or adjusting your search to find what you're looking for."
          className="empty-state-fade"
        >
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {filters.os !== 'all' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateFilters({ os: 'all' })}
              >
                Show all OS
              </Button>
            )}
            {filters.category && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateFilters({ category: null })}
              >
                Remove category
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear all filters
            </Button>
          </div>
        </EmptyState>
      )}

      {selectionMode && (
        <ExportSelectionBar
          selectedCount={selectedIds.size}
          hiddenCount={hiddenSelected.length}
          onShowAll={clearFilters}
          onClear={() => setSelectedIds(new Set())}
          onExport={() => setExportOpen(true)}
        />
      )}

      <ExportBundleDialog
        sampleIds={[...selectedIds]}
        open={exportOpen}
        onOpenChange={setExportOpen}
        onExported={exitSelectionMode}
      />
    </div>
  )
}

/**
 * A card's entrance animation, fixed at mount: swapping the class on screen restarts the animation
 * from opacity 0, so every card would blink when the entrance window closes.
 */
function GalleryCardFrame({
  index,
  entered,
  children,
}: {
  index: number
  entered: boolean
  children: ReactNode
}) {
  const [staggerIndex] = useState(entered ? null : index)
  if (staggerIndex === null) {
    return <div className="card-fade">{children}</div>
  }
  const stagger: CSSProperties & { '--card-index': number } = {
    '--card-index': staggerIndex,
  }
  return (
    <div className="card-stagger" style={stagger}>
      {children}
    </div>
  )
}

/**
 * On mount: normalize unsupported params, restore scroll, record this view, then track scroll.
 * One effect, so each step sees the previous one's effect on `window.location`.
 */
function useGalleryReturnContext() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (hasRetiredGalleryParams(params)) {
      writeGalleryFilters(parseGalleryFilters(params))
    }
    const saved = readGalleryReturn()
    if (saved && saved.search === window.location.search && saved.y > 0) {
      window.scrollTo({ top: saved.y, behavior: 'instant' })
    }
    recordGalleryEntry()
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => recordGalleryEntry())
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])
}

/** "Showing 4 of 13 samples", and whether compatibility could be checked. */
function GalleryStatusLine({ shown }: { shown: number }) {
  const {
    loading: systemLoading,
    error: systemError,
    retry: retrySystemInfo,
  } = useSystemInfo()
  return (
    <div
      role="status"
      className="text-muted-foreground flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2 text-sm"
    >
      <span>
        Showing <span className="text-foreground font-medium">{shown}</span> of{' '}
        {plural(samples.length, 'sample')}
      </span>
      {systemLoading ? (
        <span className="inline-flex items-center gap-1.5">
          <Loader className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Checking compatibility…
        </span>
      ) : systemError ? (
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5">
            <WifiOff className="h-3.5 w-3.5" aria-hidden />
            Compatibility not checked
          </span>
          <Button variant="outline" size="xs" onClick={retrySystemInfo}>
            <RefreshCw aria-hidden />
            Retry
          </Button>
        </span>
      ) : null}
    </div>
  )
}

/** Selection-mode export toolbar, portalled to <body> so it stays fixed to the viewport. */
function ExportSelectionBar({
  selectedCount,
  hiddenCount,
  onShowAll,
  onClear,
  onExport,
}: {
  selectedCount: number
  /** Selected samples the current filters hide. */
  hiddenCount: number
  onShowAll: () => void
  onClear: () => void
  onExport: () => void
}) {
  return createPortal(
    <div
      className="animate-in slide-in-from-bottom-4 fade-in fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4 duration-300"
      style={{ bottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
    >
      {hiddenCount > 0 && (
        <p className="bg-background/95 text-muted-foreground rounded-full border px-3 py-1 text-xs shadow-sm backdrop-blur-sm">
          {hiddenCount} selected{' '}
          {hiddenCount === 1 ? 'sample is' : 'samples are'} hidden by the
          current filters ·{' '}
          <button
            type="button"
            className="text-primary font-medium hover:underline"
            onClick={onShowAll}
          >
            Show all
          </button>
        </p>
      )}
      <div
        role="toolbar"
        aria-label="Export selection"
        className="surface-panel flex items-center gap-1.5 rounded-full py-1.5 pr-1.5 pl-2 shadow-xl"
      >
        <span className="flex items-center gap-2 px-2.5 text-sm">
          <CountPill count={selectedCount} />
          <span className="text-muted-foreground">selected</span>
        </span>
        {selectedCount > 0 && (
          <>
            <Separator orientation="vertical" className="!h-5" />
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground rounded-full"
              onClick={onClear}
            >
              Clear
            </Button>
          </>
        )}
        <Button
          size="sm"
          className="gap-2 rounded-full"
          disabled={selectedCount === 0}
          onClick={onExport}
        >
          <Download className="h-4 w-4" aria-hidden />
          Export selected
        </Button>
      </div>
    </div>,
    document.body,
  )
}

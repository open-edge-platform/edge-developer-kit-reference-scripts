// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { Virtualizer } from '@tanstack/react-virtual'
import type { RefObject } from 'react'
import { useLayoutEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { LogLevel } from '@/types/common'
import type { LogEntry } from '../hooks/use-log'
import { useVirtualRows } from '../hooks/use-virtual-rows'
import { formatLogTime } from '../log-message'
import { LogMessage } from './log-message'

const LEVEL_TEXT: Record<LogLevel, string> = {
  INFO: 'bg-primary/10 text-primary ring-primary/15',
  WARN: 'bg-warning/10 text-warning ring-warning/20',
  ERROR: 'bg-destructive/10 text-destructive ring-destructive/20',
  DEBUG: 'bg-muted text-muted-foreground ring-border',
}

/** Before a row is measured; wrapped rows especially vary from this a lot. */
const ESTIMATED_ROW_HEIGHT = 36
const OVERSCAN = 12

function LogRowContent({
  entry,
  showSource,
  wrap,
  isLast,
}: {
  entry: LogEntry
  showSource: boolean
  wrap: boolean
  isLast: boolean
}) {
  return (
    <div
      data-entry-id={entry.id}
      data-level={entry.level}
      className={cn(
        // Stacked on phones: time and level, then the message.
        'border-border/40 hover:bg-muted/60 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-3 py-2 transition-colors sm:grid sm:gap-x-4',
        isLast && 'border-b-0',
        wrap
          ? showSource
            ? 'sm:grid-cols-[8ch_7ch_minmax(0,1fr)_16ch]'
            : 'sm:grid-cols-[8ch_7ch_minmax(0,1fr)]'
          : showSource
            ? 'sm:grid-cols-[8ch_7ch_minmax(max-content,1fr)_16ch]'
            : 'sm:grid-cols-[8ch_7ch_minmax(max-content,1fr)]',
        entry.level === 'ERROR' && 'bg-destructive/5 dark:bg-destructive/10',
        entry.level === 'WARN' && 'bg-warning/5',
      )}
    >
      <time
        dateTime={entry.timestamp}
        title={entry.timestamp}
        className="text-muted-foreground/80 tabular-nums"
      >
        {formatLogTime(entry.timestamp)}
      </time>
      <span
        className={cn(
          'inline-flex justify-center rounded px-1.5 py-0.5 text-xs leading-4 font-semibold ring-1 ring-inset',
          LEVEL_TEXT[entry.level],
        )}
      >
        {entry.level}
      </span>
      {showSource && (
        <span
          className="text-muted-foreground/70 min-w-0 truncate sm:order-last sm:text-right"
          title={entry.source}
        >
          {entry.source}
        </span>
      )}
      <div
        className={cn(
          'min-w-0 basis-full [overflow-wrap:anywhere] sm:basis-auto',
          wrap ? 'break-words whitespace-pre-wrap' : 'whitespace-pre',
          entry.level === 'DEBUG'
            ? 'text-muted-foreground'
            : 'text-foreground/90',
        )}
      >
        <LogMessage message={entry.message} level={entry.level} wrap={wrap} />
      </div>
    </div>
  )
}

/** Renders `entries` virtualized: only rows near the viewport are in the DOM. */
export function LogRows({
  entries,
  showSource,
  wrap,
  following,
  containerRef,
  virtualizerRef,
}: {
  entries: LogEntry[]
  showSource: boolean
  wrap: boolean
  following: boolean
  containerRef: RefObject<HTMLDivElement | null>
  virtualizerRef: RefObject<Virtualizer<HTMLDivElement, HTMLDivElement> | null>
}) {
  const totalRef = useRef<HTMLDivElement>(null)
  // Widest measured row so far: absolutely positioned rows don't otherwise
  // grow their scrollable ancestor's width, which no-wrap mode needs.
  const maxRowWidthRef = useRef(0)

  const { virtualizer, items, totalSize } = useVirtualRows({
    count: entries.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (i) => entries[i].id,
  })

  useLayoutEffect(() => {
    virtualizerRef.current = virtualizer
  }, [virtualizerRef, virtualizer])

  useLayoutEffect(() => {
    maxRowWidthRef.current = 0
    if (totalRef.current) totalRef.current.style.width = ''
    virtualizer.measure()
  }, [wrap, virtualizer])

  // Row heights settle after paint (measureElement); keep pinning to the
  // newest line as they do, and while following.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (following && el) el.scrollTop = el.scrollHeight
  })

  const measureRow = (node: HTMLDivElement | null) => {
    virtualizer.measureElement(node)
    if (wrap || !node) return
    const width = node.scrollWidth
    if (width > maxRowWidthRef.current) {
      maxRowWidthRef.current = width
      if (totalRef.current) totalRef.current.style.width = `${width}px`
    }
  }

  return (
    <div ref={totalRef} style={{ position: 'relative', height: totalSize }}>
      {items.map((item) => {
        const entry = entries[item.index]
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={measureRow}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: wrap ? '100%' : 'max-content',
              minWidth: '100%',
              transform: `translateY(${item.start}px)`,
            }}
          >
            <LogRowContent
              entry={entry}
              showSource={showSource}
              wrap={wrap}
              isLast={item.index === entries.length - 1}
            />
          </div>
        )
      })}
    </div>
  )
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { Virtualizer } from '@tanstack/react-virtual'
import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { LogEntry } from './use-log'

/** How close to the end still counts as reading the latest line. */
const BOTTOM_SLACK_PX = 12

type RowVirtualizer = Virtualizer<HTMLDivElement, HTMLDivElement>

interface Anchor {
  id: number
  /** How far the reader has scrolled past the top of that row. */
  offset: number
}

/** The first rendered row at or below the scroll position. */
function findAnchor(
  virtualizer: RowVirtualizer,
  scrollTop: number,
): Anchor | null {
  const items = virtualizer.getVirtualItems()
  const item = items.find((i) => i.end > scrollTop) ?? items[0]
  if (!item) return null
  return { id: Number(item.key), offset: scrollTop - item.start }
}

/**
 * Follows the newest log line until the reader scrolls away and keeps their place while paused,
 * also across the force-mounted tab being hidden and shown (reported via `onVisibleChange`).
 */
export function useLogFollow({
  containerRef,
  contentRef,
  virtualizerRef,
  entries,
  newestId,
  onVisibleChange,
}: {
  containerRef: RefObject<HTMLDivElement | null>
  /** Its content, observed for size changes along with it. */
  contentRef: RefObject<HTMLDivElement | null>
  virtualizerRef: RefObject<RowVirtualizer | null>
  /** The entries shown, oldest first. */
  entries: LogEntry[]
  /** The newest retained entry: anything after it is new once paused. */
  newestId: number
  /** A hidden tab (display:none) reports no size. */
  onVisibleChange: (visible: boolean) => void
}) {
  const [following, setFollowing] = useState(true)
  const [pausedAfterId, setPausedAfterId] = useState(0)
  const anchorRef = useRef<Anchor | null>(null)
  const hiddenRef = useRef(false)
  const entriesRef = useRef(entries)
  // Refs are for the ResizeObserver callback below, not this render.
  useLayoutEffect(() => {
    entriesRef.current = entries
  })

  const follow = () => {
    anchorRef.current = null
    setFollowing(true)
  }

  const pause = () => {
    const el = containerRef.current
    const virtualizer = virtualizerRef.current
    anchorRef.current =
      el && virtualizer ? findAnchor(virtualizer, el.scrollTop) : null
    setFollowing(false)
    setPausedAfterId(newestId)
  }

  const onScroll = () => {
    const el = containerRef.current
    // A hidden tab reports no size; its scroll position is not the reader's.
    if (!el || hiddenRef.current || el.clientHeight === 0) return
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX
    if (atBottom) {
      if (!following) follow()
    } else if (following) {
      pause()
    } else {
      const virtualizer = virtualizerRef.current
      anchorRef.current = virtualizer
        ? findAnchor(virtualizer, el.scrollTop)
        : null
    }
  }

  useEffect(() => {
    const el = containerRef.current
    const content = contentRef.current
    if (!el || !content) return
    const observer = new ResizeObserver(() => {
      // The force-mounted tab is hidden with display:none, which can drop
      // the scroll position: put the reader back when it shows again.
      if (el.clientHeight === 0) {
        hiddenRef.current = true
        onVisibleChange(false)
        return
      }
      const wasHidden = hiddenRef.current
      hiddenRef.current = false
      onVisibleChange(true)
      if (following) {
        el.scrollTop = el.scrollHeight
        return
      }
      const anchor = anchorRef.current
      const virtualizer = virtualizerRef.current
      if (!wasHidden || !anchor || !virtualizer) return
      const index = entriesRef.current.findIndex((e) => e.id === anchor.id)
      if (index === -1) return
      const offset = virtualizer.getOffsetForIndex(index, 'start')
      if (!offset) return
      el.scrollTop = offset[0] + anchor.offset
    })
    observer.observe(el)
    observer.observe(content)
    return () => observer.disconnect()
  }, [following, containerRef, contentRef, virtualizerRef, onVisibleChange])

  const newCount = following
    ? 0
    : entries.filter((e) => e.id > pausedAfterId).length

  return { following, newCount, follow, pause, onScroll }
}

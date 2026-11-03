// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  elementScroll,
  observeElementOffset,
  observeElementRect,
  Virtualizer,
  type VirtualItem,
  type VirtualizerOptions,
} from '@tanstack/react-virtual'
import { useLayoutEffect, useReducer, useState } from 'react'
import { flushSync } from 'react-dom'

type RowVirtualizer = Virtualizer<HTMLDivElement, HTMLDivElement>

export type VirtualRowsOptions = Pick<
  VirtualizerOptions<HTMLDivElement, HTMLDivElement>,
  'count' | 'getScrollElement' | 'estimateSize' | 'overscan' | 'getItemKey'
>

/** Builds the virtualizer outside React; `measuring` is closure state, used only in its callbacks. */
function createRows(options: VirtualRowsOptions, rerender: () => void) {
  let measuring = false
  const toOptions = (
    next: VirtualRowsOptions,
  ): VirtualizerOptions<HTMLDivElement, HTMLDivElement> => ({
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    ...next,
    onChange: (_instance, sync) => {
      // `measureElement` is a ref callback, so its sync notify arrives while
      // React is committing, where flushSync cannot flush (and warns).
      if (sync && !measuring) flushSync(rerender)
      else rerender()
    },
  })
  const virtualizer: RowVirtualizer = new Virtualizer(toOptions(options))
  const measureElement = virtualizer.measureElement
  virtualizer.measureElement = (node) => {
    measuring = true
    try {
      measureElement(node)
    } finally {
      measuring = false
    }
  }
  return { virtualizer, toOptions }
}

/**
 * Hands the virtualizer this render's options and reads the rows. Everything the answer depends on
 * is an argument, so the React Compiler reruns it on any change instead of serving a stale range.
 */
function syncRows(
  rows: ReturnType<typeof createRows>,
  options: VirtualRowsOptions,
  version: number,
) {
  rows.virtualizer.setOptions(rows.toOptions(options))
  const items: VirtualItem[] = rows.virtualizer.getVirtualItems()
  return { items, totalSize: rows.virtualizer.getTotalSize(), version }
}

/**
 * `useVirtualizer` for a scrolling `<div>` that the React Compiler can memoize; `virtualizer` is the
 * stable instance for measuring and imperative scrolling.
 */
export function useVirtualRows(options: VirtualRowsOptions) {
  const [version, rerender] = useReducer((n: number) => n + 1, 0)
  const [rows] = useState(() => createRows(options, rerender))
  const { virtualizer } = rows
  const view = syncRows(rows, options, version)

  useLayoutEffect(() => virtualizer._didMount(), [virtualizer])
  useLayoutEffect(() => virtualizer._willUpdate())

  return { virtualizer, items: view.items, totalSize: view.totalSize }
}

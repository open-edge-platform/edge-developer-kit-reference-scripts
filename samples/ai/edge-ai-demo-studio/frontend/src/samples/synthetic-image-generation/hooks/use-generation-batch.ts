// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect } from 'react'
import { useLeaveGuard } from '@/components/common/leave-guard'
import { useStoreSnapshot } from '@/services/common/demo/snapshot-store'
import type { GenerationRequest } from '../lib/api'
import {
  type GenerationQueueState,
  generationQueue,
  isSettled,
  tallyBatch,
} from '../lib/generation-batch'

const EMPTY: GenerationQueueState = { items: [], batchIds: [] }

/**
 * The images this tab generates on the instance at `apiBase`. The worker keeps making them when the
 * page goes away, so leaving while images are in the works asks first.
 */
export function useGenerationBatch(apiBase: string | undefined) {
  // Module level, one per instance: it outlives this page.
  const queue =
    apiBase && typeof window !== 'undefined' ? generationQueue(apiBase) : null
  const state = useStoreSnapshot(queue, EMPTY)

  // Follow what is still in the works, e.g. images a reload left running.
  useEffect(() => queue?.attach(), [queue])

  const isGenerating = state.items.some((item) => !isSettled(item))
  useLeaveGuard(isGenerating, {
    title: 'Leave while images are generating?',
    description:
      'The images keep generating on the worker, and each finished one is saved to its project. Come back to this page to follow them.',
    confirmLabel: 'Leave page',
    cancelLabel: 'Stay on page',
  })

  const tally = tallyBatch(state)
  const cancelling = state.items.some((item) => item.cancelling)

  return {
    items: state.items,
    start: (request: GenerationRequest, count: number) =>
      queue?.generate(request, count),
    cancel: () => queue?.cancel(),
    retry: (id: string) => queue?.retry(id),
    remove: (id: string) => queue?.remove(id),
    forgetUrl: (url: string) => queue?.forgetUrl(url),
    isGenerating,
    tally,
    /** Which image of the latest batch is being made, while one is. */
    progress:
      tally && tally.active > 0
        ? {
            index: Math.min(tally.total, tally.total - tally.active + 1),
            total: tally.total,
            cancelling,
          }
        : isGenerating
          ? { index: 1, total: 1, cancelling }
          : null,
  }
}

export type GenerationBatchState = ReturnType<typeof useGenerationBatch>

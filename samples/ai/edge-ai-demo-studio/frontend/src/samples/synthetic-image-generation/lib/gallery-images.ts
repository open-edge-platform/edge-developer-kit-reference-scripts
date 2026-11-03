// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { GenerationType } from './api'
import type { GenerationItem } from './generation-batch'
import { parseHistoryUrl } from './history'
import type { GeneratedImage } from './types'

/** A generated (or failed, or still generating) image of this tab, for the gallery. */
function itemImage(item: GenerationItem): GeneratedImage {
  const { summary } = item
  return {
    id: item.id,
    url: item.asset?.imageUrl ?? '',
    maskUrl: item.asset?.maskUrl,
    type: summary.type,
    customTypeRaw:
      summary.type === GenerationType.CUSTOM ? summary.customType : undefined,
    timestamp: item.createdAt,
    isLoading: item.phase !== 'done' && item.phase !== 'failed',
    project: summary.projectName,
    job: item.status
      ? {
          ...item.status,
          cancel_requested: item.cancelling || item.status.cancel_requested,
        }
      : item.cancelling
        ? { status: 'queued', cancel_requested: true }
        : item.phase === 'queued'
          ? { status: 'queued' }
          : undefined,
    failure:
      item.phase === 'failed'
        ? {
            error: item.error ?? 'Image generation failed',
            canRetry: item.request !== null,
          }
        : undefined,
  }
}

/**
 * The gallery: this tab's images (running placeholders, failures) first, then the worker's history.
 * Deduped by URL, so a generated image shows once (from the history once listed) and a refetch
 * never shifts which image is which. Cancelled images are not shown.
 */
export function galleryImages(
  historyUrls: readonly string[],
  items: readonly GenerationItem[],
): GeneratedImage[] {
  const listed = new Set(historyUrls)
  return [
    ...items
      .filter((item) => item.phase !== 'cancelled')
      .map(itemImage)
      .filter((img) => !img.url || !listed.has(img.url)),
    ...historyUrls.map(parseHistoryUrl),
  ]
}

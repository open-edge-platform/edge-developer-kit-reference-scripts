// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ImageJobStatus } from './image-job'

/**
 * Percent done and seconds left. The model server reports no steps, so this guesses from
 * `seconds_per_image`, else the job's estimate. Null once the image in progress outruns its
 * estimate (or there is none), when only an indeterminate bar is honest.
 */
export function estimatedProgress({
  n,
  images_done: done,
  elapsed_time: elapsedTime,
  estimated_time: estimatedTime,
  seconds_per_image: perImage,
  started,
  image_started: imageStarted,
}: ImageJobStatus): { pct: number; remaining: number } | null {
  const total = Math.max(n, 1)
  if (perImage && started != null && imageStarted != null) {
    // Worker clock only: the browser's may differ.
    const imageElapsed = Math.max(0, elapsedTime - (imageStarted - started))
    if (imageElapsed >= perImage * 0.95) return null
    return {
      pct: Math.round(((done + imageElapsed / perImage) / total) * 100),
      remaining: (total - done) * perImage - imageElapsed,
    }
  }
  if (!estimatedTime) return null
  const share = elapsedTime / estimatedTime
  if (share >= (done + 0.95) / total) return null
  return {
    pct: Math.round(Math.max(share, done / total) * 100),
    remaining: Math.max(0, estimatedTime - elapsedTime),
  }
}

/** Where a job waiting for its turn is in the worker's queue. */
export function queueHint(position: number | null | undefined): string {
  if (!position) return 'Waiting for the worker to start the job'
  const ahead = position - 1
  return ahead === 0
    ? 'Next in line: the worker makes one image at a time'
    : `Queued behind ${ahead} other request${ahead > 1 ? 's' : ''} on this worker`
}

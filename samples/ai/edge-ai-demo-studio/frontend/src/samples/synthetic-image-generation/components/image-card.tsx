// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  AlertTriangle,
  Download,
  Loader,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import NextImage from 'next/image'
import { TruncatedText } from '@/components/common/truncated-text'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { GenerationType, type SyntheticJobStatus } from '../lib/api'
import type { GeneratedImage } from '../lib/types'
import { TypeBadge } from './type-badge'

/** What an image still being generated is waiting on. */
function jobLabel(job: SyntheticJobStatus | undefined): string {
  if (!job) return 'Submitting...'
  if (job.cancel_requested) return 'Cancelling...'
  switch (job.stage ?? job.status) {
    case 'queued':
    case 'pending':
      return job.jobs_ahead ? `Queued · ${job.jobs_ahead} ahead` : 'Queued'
    case 'preparing':
      return 'Preparing...'
    case 'segmenting':
      return 'Finding a component...'
    case 'generating':
      return job.steps
        ? `Step ${job.step ?? 0} of ${job.steps}`
        : 'Generating...'
    case 'saving':
      return 'Saving...'
    default:
      return 'Generating...'
  }
}

/** The file name the worker gave the image, its id in the gallery. */
export function imageFileName(img: GeneratedImage): string {
  return img.url.split('/').pop() || img.id
}

interface ImageCardProps {
  img: GeneratedImage
  /** Another image's download is in progress: the actions wait. */
  busy: boolean
  onSelect: () => void
  onDownload: () => void
  onDelete: () => void
  /** A failed image: send its request again. */
  onRetry: () => void
  /** A failed image: take it out of the gallery. */
  onRemove: () => void
}

export function ImageCard({
  img,
  busy,
  onSelect,
  onDownload,
  onDelete,
  onRetry,
  onRemove,
}: ImageCardProps) {
  const fileName = imageFileName(img)
  const { failure } = img
  const badges = (
    <div className="absolute top-2 left-2 flex gap-1">
      <TypeBadge type={img.type} />
      {img.type === GenerationType.CUSTOM && img.customTypeRaw && (
        <span className="bg-primary/90 border-border/50 rounded-full border px-2 py-0.5 text-xs font-bold text-white uppercase shadow-md backdrop-blur-sm">
          {img.customTypeRaw}
        </span>
      )}
    </div>
  )

  if (failure) {
    return (
      <div
        data-testid="synthetic-image-failed"
        className="bg-card border-destructive/40 overflow-hidden rounded-xl border shadow-lg"
      >
        <div className="bg-destructive/5 relative flex aspect-square flex-col items-center justify-center gap-2 p-4 pt-10 text-center">
          <AlertTriangle className="text-destructive h-7 w-7" aria-hidden />
          <p className="text-foreground text-sm font-medium">
            Generation failed
          </p>
          <p
            className="text-muted-foreground line-clamp-4 text-xs break-words"
            data-testid="synthetic-image-error"
          >
            {failure.error}
          </p>
          {!failure.canRetry && (
            <p className="text-muted-foreground text-xs">
              Its images were not kept after the page reloaded: upload them
              again to try once more.
            </p>
          )}
          {badges}
        </div>
        <div className="space-y-2 p-4">
          <span className="text-muted-foreground block text-xs">
            {new Date(img.timestamp).toLocaleTimeString()}
          </span>
          <div className="flex flex-wrap gap-2">
            {failure.canRetry && (
              <Button
                size="sm"
                onClick={onRetry}
                className="gap-1.5"
                data-testid="synthetic-image-retry"
              >
                <RotateCcw aria-hidden />
                Retry
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={onRemove}
              className="gap-1.5"
              data-testid="synthetic-image-remove"
            >
              <X aria-hidden />
              Remove
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-card border-border group hover:border-primary/50 overflow-hidden rounded-xl border shadow-lg transition-colors">
      {img.isLoading ? (
        <div className="relative aspect-square overflow-hidden">
          <Skeleton className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-none">
            <Loader className="text-primary h-8 w-8 animate-spin" aria-hidden />
            <span
              className="text-muted-foreground text-xs"
              data-testid="synthetic-image-progress"
            >
              {jobLabel(img.job)}
            </span>
            <Progress
              value={Math.round((img.job?.progress ?? 0) * 100)}
              aria-label="Generation progress"
              className="h-1.5 w-2/3"
            />
          </Skeleton>
          {badges}
        </div>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          aria-label={`Preview ${fileName}`}
          className="focus-visible:ring-ring/50 relative block aspect-square w-full cursor-pointer overflow-hidden outline-none focus-visible:ring-[3px]"
        >
          <NextImage
            src={img.url}
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            alt=""
            fill
            unoptimized
          />
          {badges}
        </button>
      )}
      <div className="flex items-center justify-between gap-2 p-4">
        <div className="flex min-w-0 flex-col">
          {img.isLoading ? (
            <span className="text-muted-foreground text-xs">In progress</span>
          ) : (
            <TruncatedText
              text={fileName}
              className="text-muted-foreground font-mono text-xs"
            />
          )}
          <span className="text-muted-foreground text-xs">
            {new Date(img.timestamp).toLocaleTimeString()}
          </span>
        </div>
        {!img.isLoading && (
          <div className="flex gap-2">
            <Button
              size="icon-sm"
              onClick={onDownload}
              disabled={busy}
              aria-label={`Download ${fileName}`}
              title="Download"
            >
              <Download aria-hidden />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              onClick={onDelete}
              disabled={busy}
              aria-label={`Delete ${fileName}`}
              title="Delete"
              className="hover:border-destructive/50 hover:text-destructive"
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Download, ImageIcon } from 'lucide-react'
import Image from 'next/image'
import { EmptyState } from '@/components/common/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { downloadUrl } from '@/lib/browser/download'
import { cn } from '@/lib/utils'
import { type ImageJobState, isRunActive } from '../lib/image-job'
import { RunOutcome } from './run-outcome'
import { RunProgress } from './run-progress'

/** `512x512` as `512 × 512`. */
function formatSize(size: string) {
  return size.replace('x', ' × ')
}

/** The request in flight or how the last one ended, and the latest image with its settings. */
export function ImageOutput({
  state,
  label,
  noun,
  verb,
  onCancel,
  onReconnect,
  available,
  'data-testid': testId,
}: {
  state: ImageJobState
  /** `Generated image` or `Edited image`. */
  label: string
  /** `Generation` or `Edit`, for the outcome of a request. */
  noun: string
  /** `Generating` or `Editing`, while a request runs. */
  verb: string
  onCancel: () => void
  onReconnect: () => void
  available: boolean
  'data-testid'?: string
}) {
  const { run, result } = state
  const active = isRunActive(run)
  // An image next to a newer request (running, failed or lost) is the previous result.
  const previous = Boolean(result && run)
  const image = result?.images[0]
  const downloadName = label.toLowerCase()

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-foreground text-sm font-medium">{label}</h3>
        {result && (
          <Badge variant="secondary" className="text-xs">
            {result.settings.size ? formatSize(result.settings.size) : null}
            {result.settings.num_inference_steps != null &&
              ` · ${result.settings.num_inference_steps} steps`}
          </Badge>
        )}
      </div>

      {run?.resumed && active && (
        <p
          role="status"
          data-testid="imggen-resumed"
          className="text-muted-foreground text-xs"
        >
          Picked up the request you started before leaving this page.
        </p>
      )}

      {run && active && (
        <RunProgress run={run} verb={verb} onCancel={onCancel} />
      )}
      {run && !active && (
        <RunOutcome
          run={run}
          noun={noun}
          onReconnect={onReconnect}
          canReconnect={available}
        />
      )}

      <div
        data-testid={testId}
        className={cn(
          'border-border relative flex aspect-square items-center justify-center overflow-hidden rounded-xl border',
          image ? 'bg-muted/10' : 'bg-muted/20',
        )}
      >
        {image ? (
          <>
            <Image
              src={image}
              alt={previous ? `Previous result: ${downloadName}` : label}
              fill
              className={cn(
                'object-contain transition-opacity',
                active && 'opacity-60',
              )}
              unoptimized
            />
            {previous && (
              <span
                data-testid="imggen-previous-result"
                className="bg-background text-foreground border-border absolute top-2 left-2 rounded-md border px-2 py-0.5 text-xs font-medium shadow-sm"
              >
                Previous result
              </span>
            )}
          </>
        ) : active ? (
          <Skeleton className="h-full w-full rounded-none" />
        ) : (
          <EmptyState
            icon={ImageIcon}
            size="sm"
            description={`${label} will appear here`}
          />
        )}
      </div>

      {image && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() =>
            downloadUrl(image, `${downloadName.replace(/\s+/g, '-')}.png`)
          }
        >
          <Download aria-hidden="true" className="h-3.5 w-3.5" />
          Download {downloadName}
        </Button>
      )}
    </div>
  )
}

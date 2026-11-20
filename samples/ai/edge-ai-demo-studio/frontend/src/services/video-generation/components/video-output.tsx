// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { AlertTriangle, Clapperboard, Download, RefreshCw } from 'lucide-react'
import { EmptyState } from '@/components/common/empty-state'
import { InlineNotice } from '@/components/common/inline-notice'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { downloadUrl } from '@/lib/browser/download'
import { cn } from '@/lib/utils'
import {
  isRunActive,
  type VideoJobState,
  type VideoRun,
} from '../lib/video-job'
import { RunProgress } from './run-progress'
import { StepView, stepSources } from './step-view'

const ICON = (
  <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
)

/** Why the last request did not produce a video, above whatever is kept. */
function RunOutcome({
  run,
  onReconnect,
  canReconnect,
}: {
  run: VideoRun
  onReconnect: () => void
  canReconnect: boolean
}) {
  if (run.phase === 'failed') {
    return (
      <InlineNotice
        tone="destructive"
        data-testid="videogen-error"
        className="items-start"
        icon={ICON}
      >
        <span className="block font-medium">Video generation failed</span>
        {run.error && <span className="block break-words">{run.error}</span>}
      </InlineNotice>
    )
  }
  if (run.phase === 'cancelled') {
    return (
      <p
        role="status"
        data-testid="videogen-cancelled"
        className="border-border bg-muted/30 text-muted-foreground rounded-lg border px-3 py-2 text-xs"
      >
        Video cancelled
      </p>
    )
  }
  if (run.phase !== 'lost') return null
  return (
    <InlineNotice
      tone="warning"
      role="alert"
      data-testid="videogen-job-lost"
      className="items-start"
      icon={ICON}
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={onReconnect}
          disabled={!canReconnect}
        >
          <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
          Check again
        </Button>
      }
    >
      <span className="block font-medium">Lost track of this video</span>
      <span className="block break-words">
        {run.error ? `${run.error} ` : ''}It was not sent again.
      </span>
    </InlineNotice>
  )
}

/** `1280x704` as `1280 × 704`. */
const formatSize = (size: string) => size.replace('x', ' × ')

/** The video in progress or how the last request ended, and the latest video with its settings. */
export function VideoOutput({
  state,
  onCancel,
  onReconnect,
  available,
}: {
  state: VideoJobState
  onCancel: () => void
  onReconnect: () => void
  available: boolean
}) {
  const { run, result } = state
  const active = isRunActive(run)
  // A video being made shows its steps as they come, in place of the last one.
  const making = Boolean(active && run && run.previews.length > 0)
  // A video next to a newer request (running, failed or lost) is the previous result.
  const previous = Boolean(result && run) && !making
  const shownSize = making ? run?.settings.size : result?.settings.size
  // The badge describes the video being made while there is one (the worker's own numbers once it
  // has said: a driving video can make it shorter), else the last result.
  const badge =
    active && run
      ? {
          size: run.settings.size,
          seconds: Number(run.status?.seconds) || null,
          frames: run.status?.num_frames ?? run.settings.num_frames,
          steps: run.steps ?? run.settings.num_inference_steps ?? null,
          seed: run.status?.seed ?? null,
        }
      : result
        ? {
            size: result.settings.size,
            seconds: result.seconds,
            frames: result.settings.num_frames,
            steps: result.settings.num_inference_steps ?? null,
            seed: result.seed,
          }
        : null
  const portrait = (() => {
    const [w, h] = (shownSize ?? '16x9').split('x').map(Number)
    return h > w
  })()
  const sources =
    making && run
      ? stepSources(run.previews)
      : result
        ? stepSources(result.previews, {
            src: result.video,
            steps: result.steps,
          })
        : []
  const frameClassName = cn(
    'border-border relative flex items-center justify-center overflow-hidden rounded-xl border bg-black/90',
    portrait ? 'mx-auto aspect-[9/16] max-h-[70vh]' : 'aspect-video',
    sources.length === 0 && 'bg-muted/20',
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-foreground text-sm font-medium">Generated video</h3>
        {badge && (
          <Badge
            variant="secondary"
            className="text-xs"
            data-testid="videogen-result-badge"
          >
            {formatSize(badge.size)}
            {badge.seconds != null && ` · ${badge.seconds} s`}
            {` · ${badge.frames} frames`}
            {badge.steps != null && ` · ${badge.steps} steps`}
            {badge.seed != null && ` · seed ${badge.seed}`}
          </Badge>
        )}
      </div>

      {run?.resumed && active && (
        <p
          role="status"
          data-testid="videogen-resumed"
          className="text-muted-foreground text-xs"
        >
          Picked up the video you started before leaving this page.
        </p>
      )}
      {run && active && <RunProgress run={run} onCancel={onCancel} />}
      {run && !active && (
        <RunOutcome
          run={run}
          onReconnect={onReconnect}
          canReconnect={available}
        />
      )}

      {sources.length > 0 ? (
        <StepView
          // A new video starts at its latest step, and the finished one at the video itself.
          key={making ? `run:${run?.jobId}` : result?.video}
          sources={sources}
          steps={making ? (run?.steps ?? null) : (result?.steps ?? null)}
          making={making}
          dimmed={previous && active}
          frameClassName={frameClassName}
        >
          {previous && (
            <span
              data-testid="videogen-previous-result"
              className="bg-background text-foreground border-border absolute top-2 left-2 rounded-md border px-2 py-0.5 text-xs font-medium shadow-sm"
            >
              Previous result
            </span>
          )}
        </StepView>
      ) : (
        <div data-testid="videogen-output" className={frameClassName}>
          {active ? (
            <Skeleton className="h-full w-full rounded-none" />
          ) : (
            <EmptyState
              icon={Clapperboard}
              size="sm"
              description="The generated video will appear here"
            />
          )}
        </div>
      )}

      {result?.control && (
        <figure className="space-y-1.5" data-testid="videogen-control">
          <video
            key={result.control}
            src={result.control}
            data-testid="videogen-control-video"
            className="border-border aspect-video w-1/2 rounded-lg border bg-black object-contain"
            autoPlay
            loop
            muted
            playsInline
          />
          <figcaption className="text-muted-foreground text-xs">
            The poses it followed, drawn from your video
          </figcaption>
        </figure>
      )}

      {result && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          data-testid="videogen-download"
          onClick={() => downloadUrl(result.video, 'generated-video.mp4')}
        >
          <Download aria-hidden="true" className="h-3.5 w-3.5" />
          Download MP4
        </Button>
      )}
    </div>
  )
}

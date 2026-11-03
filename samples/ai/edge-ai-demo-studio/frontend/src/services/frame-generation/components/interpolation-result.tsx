// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Download, Film, Loader } from 'lucide-react'
import { ConfigSection } from '@/components/configure/config-section'
import { EmptyState } from '@/components/common/empty-state'
import { InlineNotice } from '@/components/common/inline-notice'
import { RefVideo } from '@/components/common/ref-media'
import { Button } from '@/components/ui/button'
import { useObjectUrl } from '@/hooks/use-object-url'
import { downloadBlob } from '@/lib/browser/download'
import { MEDIA_SRC_CHARS, safeMediaSrc } from '@/lib/validation'
import { JobProgress } from '@/services/common/jobs/job-progress'
import type { JobRunState } from '@/services/common/jobs/use-job-run'
import {
  type InterpolationRequest,
  useResultVideo,
  type VideoTaskStatus,
} from '../hooks'

function describeResult(task: VideoTaskStatus): string {
  return task.mode === 'slowmo'
    ? `${task.multiplier}x slower · ${task.frames} frames at ${task.output_fps?.toFixed(1)} FPS`
    : `${task.input_fps?.toFixed(1)} FPS → ${task.output_fps?.toFixed(1)} FPS (${task.frames} frames)`
}

/** The finished video: played from a downloaded blob, and saved from it. */
function ResultVideo({
  taskId,
  task,
  apiBase,
}: {
  taskId: string
  task: VideoTaskStatus
  apiBase: string | undefined
}) {
  const result = useResultVideo(taskId, true, apiBase)
  const resultVideoUrl = useObjectUrl(result.data)
  let safeResultVideoUrl = ''
  for (const ch of safeMediaSrc(resultVideoUrl)) {
    let ok = ''
    for (const allowed of MEDIA_SRC_CHARS)
      if (allowed === ch) {
        ok = allowed
        break
      }
    if (!ok) {
      safeResultVideoUrl = ''
      break
    }
    safeResultVideoUrl += ok
  }

  if (result.isLoading) {
    return (
      <p
        role="status"
        className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-center text-xs"
      >
        <Loader aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
        Loading result...
      </p>
    )
  }
  if (result.isError || !result.data) {
    return (
      <InlineNotice tone="destructive" size="sm">
        Failed to load the interpolated video.
      </InlineNotice>
    )
  }
  const blob = result.data
  return (
    <div className="space-y-2">
      {safeResultVideoUrl && (
        <RefVideo
          src={safeResultVideoUrl}
          className="bg-muted/50 mx-auto max-h-64 w-auto max-w-full rounded-md object-contain"
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">{describeResult(task)}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => downloadBlob(blob, `interpolated_${taskId}.mp4`)}
        >
          <Download aria-hidden="true" className="h-3.5 w-3.5" />
          Download
        </Button>
      </div>
    </div>
  )
}

/** Where the interpolation is: queued, its progress, or how it ended. */
export function InterpolationResult({
  job,
  apiBase,
}: {
  job: JobRunState<InterpolationRequest, VideoTaskStatus, VideoTaskStatus>
  apiBase: string | undefined
}) {
  const { phase, status, jobId } = job

  const body = (() => {
    if (phase === 'queued' || phase === 'running') {
      return (
        <div className="flex justify-center py-8">
          <JobProgress
            label="Generating frames"
            queued={phase === 'queued'}
            position={status?.position}
            percent={(status?.progress ?? 0) * 100}
            detail={
              status?.frames_total
                ? `${status.frames_done ?? 0} of ~${status.frames_total} frames`
                : undefined
            }
            cancelling={job.cancelling}
            onCancel={job.cancel}
          />
        </div>
      )
    }
    if (phase === 'cancelled' && jobId) {
      return (
        <p className="text-muted-foreground py-8 text-center text-xs">
          Interpolation cancelled.
        </p>
      )
    }
    if (phase === 'failed' && jobId) {
      return (
        <InlineNotice tone="destructive" size="sm">
          Interpolation failed: {job.error?.message ?? 'unknown error'}
        </InlineNotice>
      )
    }
    if (phase === 'done' && jobId && job.result) {
      return <ResultVideo taskId={jobId} task={job.result} apiBase={apiBase} />
    }
    return (
      <EmptyState
        icon={Film}
        size="sm"
        description="The interpolated video will appear here."
        className="py-8"
      />
    )
  })()

  return (
    <ConfigSection
      title="Result"
      className="border-border space-y-4 rounded-lg border p-4"
    >
      {body}
    </ConfigSection>
  )
}

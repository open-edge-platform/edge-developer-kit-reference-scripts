// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Download, Film, Loader } from 'lucide-react'
import { ConfigSection } from '@/components/configure/config-section'
import { EmptyState } from '@/components/common/empty-state'
import { InlineNotice } from '@/components/common/inline-notice'
import { RefVideo } from '@/components/common/ref-media'
import { VideoFilePicker } from '@/components/common/video-file-picker'
import { Button } from '@/components/ui/button'
import { useObjectUrl } from '@/hooks/use-object-url'
import { downloadBlob } from '@/lib/browser/download'
import { toastError } from '@/lib/browser/toast-error'
import { MEDIA_SRC_CHARS, safeMediaSrc } from '@/lib/validation'
import type { JobPhase } from '@/services/common/jobs/job-run'
import { useDemoRuntime } from '@/services/common/demo/demo-runtime'
import { demoStateKey } from '@/services/common/demo/demo-session'
import { useSessionState } from '@/services/common/demo/session-store'
import { JobProgress } from '@/services/common/jobs/job-progress'
import type { Service } from '@/services/types'
import type { UpscalingModel } from '../config'
import {
  type UpscaleTaskStatus,
  useUpscaleJob,
  useUpscaleResult,
} from '../hooks'
import { effectiveOutscale, OutscaleSelect } from './upscale-options'

const RUN_LABEL: Partial<Record<JobPhase | 'idle', string>> = {
  submitting: 'Uploading...',
  queued: 'Queued...',
  running: 'Upscaling...',
}

function describeResult(task: UpscaleTaskStatus): string {
  const seconds = task.perf?.seconds
  return [
    `${task.input_width}×${task.input_height} → ${task.output_width}×${task.output_height}`,
    `${task.frames} frames at ${task.fps?.toFixed(1)} FPS`,
    seconds !== undefined &&
      task.frames &&
      `${(task.frames / seconds).toFixed(1)} frames/s`,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The finished video: played from a downloaded blob, and saved from it. */
function ResultVideo({
  taskId,
  task,
  apiBase,
}: {
  taskId: string
  task: UpscaleTaskStatus
  apiBase: string | undefined
}) {
  const result = useUpscaleResult('video', taskId, apiBase)
  const resultUrl = useObjectUrl(result.data)
  let safeResultUrl = ''
  for (const ch of safeMediaSrc(resultUrl)) {
    let ok = ''
    for (const allowed of MEDIA_SRC_CHARS)
      if (allowed === ch) {
        ok = allowed
        break
      }
    if (!ok) {
      safeResultUrl = ''
      break
    }
    safeResultUrl += ok
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
  if (result.isError || !result.data || !safeResultUrl) {
    return (
      <InlineNotice tone="destructive" size="sm">
        Failed to load the upscaled video.
      </InlineNotice>
    )
  }
  const blob = result.data
  return (
    <div className="space-y-2">
      <RefVideo
        src={safeResultUrl}
        className="bg-muted/50 mx-auto max-h-80 w-auto max-w-full rounded-md object-contain"
      />
      <div className="flex items-center justify-between gap-2">
        <p
          className="text-muted-foreground text-xs"
          data-testid="upscaling-video-result"
        >
          {describeResult(task)}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => downloadBlob(blob, `upscaled_${taskId}.mp4`)}
        >
          <Download aria-hidden="true" className="h-3.5 w-3.5" />
          Download
        </Button>
      </div>
    </div>
  )
}

export function VideoTab({
  service,
  model,
}: {
  service: Service
  model: UpscalingModel
}) {
  const [videoFile, setVideoFile] = useSessionState<File | null>(
    demoStateKey(service, 'image-upscaling:video'),
    null,
  )
  const [savedOutscale, setOutscale] = useSessionState(
    demoStateKey(service, 'image-upscaling:video-outscale'),
    String(model.scale),
  )
  const outscale = effectiveOutscale(savedOutscale, model.scale)
  const job = useUpscaleJob(service, 'video')
  const { available } = useDemoRuntime()
  const runLabel = RUN_LABEL[job.phase]

  const handleVideoFileChange = (file: File | null) => {
    // Its result would no longer show, so cancel the task (an upload in flight is cancelled once
    // its task id arrives).
    job.reset()
    setVideoFile(file)
  }

  const handleSubmit = async () => {
    if (!videoFile || !available) return
    const settled = await job.start({
      file: videoFile,
      outscale: Number(outscale),
    })
    if (settled.phase === 'failed' && settled.jobId === null) {
      toastError('Failed to start upscaling')(settled.error)
    }
  }

  const { phase, status, jobId } = job
  const result = (() => {
    if (phase === 'queued' || phase === 'running') {
      return (
        <div className="flex justify-center py-8">
          <JobProgress
            label="Upscaling frames"
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
          Upscaling cancelled.
        </p>
      )
    }
    if (phase === 'failed' && jobId) {
      return (
        <InlineNotice tone="destructive" size="sm">
          Upscaling failed: {job.error?.message ?? 'unknown error'}
        </InlineNotice>
      )
    }
    if (phase === 'done' && jobId && job.result) {
      return (
        <ResultVideo
          taskId={jobId}
          task={job.result}
          apiBase={service.apiBase}
        />
      )
    }
    return (
      <EmptyState
        icon={Film}
        size="sm"
        description="The upscaled video will appear here."
        className="py-8"
      />
    )
  })()

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ConfigSection
        title="Source video"
        className="border-border space-y-4 rounded-lg border p-4"
      >
        {!model.realtime && (
          <InlineNotice tone="warning" size="sm">
            This model takes up to seconds per frame, so even a short video
            takes many minutes. SPAN, the compact Real-ESRGAN models and
            Intel&apos;s Open Model Zoo model run in real time.
          </InlineNotice>
        )}
        <VideoFilePicker
          file={videoFile}
          onFileChange={handleVideoFileChange}
          accept="video/*"
          formatsHint="MP4, WebM or other common formats; frames come out at most 3840×2160"
        />
        <OutscaleSelect
          id="upscaling-video-outscale"
          scale={model.scale}
          value={outscale}
          onChange={setOutscale}
          disabled={job.isActive}
        />
        <Button
          className="w-full"
          disabled={!videoFile || !available || runLabel !== undefined}
          onClick={() => void handleSubmit()}
          data-testid="upscaling-video-run-button"
        >
          {runLabel ? (
            <Loader aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : (
            <Film aria-hidden="true" className="h-4 w-4" />
          )}
          {runLabel ?? 'Upscale video'}
        </Button>
      </ConfigSection>
      <ConfigSection
        title="Result"
        className="border-border space-y-4 rounded-lg border p-4"
      >
        {result}
      </ConfigSection>
    </div>
  )
}

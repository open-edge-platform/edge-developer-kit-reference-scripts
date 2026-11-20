// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Download, ImageUpscale, Loader } from 'lucide-react'
import { ConfigSection } from '@/components/configure/config-section'
import { EmptyState } from '@/components/common/empty-state'
import { ImageSourcePanel } from '@/components/common/image-source-panel'
import { InlineNotice } from '@/components/common/inline-notice'
import { RefImage } from '@/components/common/ref-media'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useImageSource } from '@/hooks/use-image-source'
import { useObjectUrl } from '@/hooks/use-object-url'
import { downloadBlob } from '@/lib/browser/download'
import { toastError } from '@/lib/browser/toast-error'
import { useDemoRuntime } from '@/services/common/demo/demo-runtime'
import { demoStateKey } from '@/services/common/demo/demo-session'
import { useSessionState } from '@/services/common/demo/session-store'
import { JobProgress } from '@/services/common/jobs/job-progress'
import type { Service } from '@/services/types'
import type { UpscalingModel } from '../config'
import {
  type ImageFormat,
  type UpscaleTaskStatus,
  useUpscaleJob,
  useUpscaleResult,
} from '../hooks'
import { CompareView } from './compare-view'
import { effectiveOutscale, OutscaleSelect } from './upscale-options'

const FORMAT_OPTIONS: { value: ImageFormat; label: string }[] = [
  { value: 'png', label: 'PNG (lossless)' },
  { value: 'webp', label: 'WebP' },
  { value: 'jpeg', label: 'JPEG' },
]

const isFormat = (value: string): value is ImageFormat =>
  FORMAT_OPTIONS.some((f) => f.value === value)

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function describeResult(task: UpscaleTaskStatus): string {
  const seconds = task.perf?.seconds
  return [
    `${task.input_width}×${task.input_height} → ${task.output_width}×${task.output_height}`,
    seconds !== undefined && `${seconds.toFixed(1)} s`,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The finished image: compared with its input, and saved from the downloaded bytes. */
function ResultImage({
  taskId,
  task,
  inputUrl,
  inputName,
  apiBase,
}: {
  taskId: string
  task: UpscaleTaskStatus
  inputUrl: string
  inputName: string
  apiBase: string | undefined
}) {
  const result = useUpscaleResult('image', taskId, apiBase)
  const resultUrl = useObjectUrl(result.data)

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
  if (result.isError || !result.data || !resultUrl) {
    return (
      <InlineNotice tone="destructive" size="sm">
        Failed to load the upscaled image.
      </InlineNotice>
    )
  }
  const blob = result.data
  const stem = inputName.replace(/\.[^.]+$/, '') || 'image'
  const extension = task.format === 'jpeg' ? 'jpg' : (task.format ?? 'png')
  return (
    <div className="space-y-3">
      <CompareView
        beforeUrl={inputUrl}
        afterUrl={resultUrl}
        width={task.output_width ?? 1}
        height={task.output_height ?? 1}
        testIdPrefix="upscaling-image"
      />
      <div className="flex items-center justify-between gap-2">
        <p
          className="text-muted-foreground text-xs"
          data-testid="upscaling-image-result"
        >
          {describeResult(task)} · {formatMegabytes(blob.size)}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => downloadBlob(blob, `${stem}_upscaled.${extension}`)}
        >
          <Download aria-hidden="true" className="h-3.5 w-3.5" />
          Download
        </Button>
      </div>
    </div>
  )
}

export function ImageTab({
  service,
  model,
}: {
  service: Service
  model: UpscalingModel
}) {
  const job = useUpscaleJob(service, 'image')
  const { available } = useDemoRuntime()
  const [savedOutscale, setOutscale] = useSessionState(
    demoStateKey(service, 'image-upscaling:image-outscale'),
    String(model.scale),
  )
  const outscale = effectiveOutscale(savedOutscale, model.scale)
  const [format, setFormat] = useSessionState<ImageFormat>(
    demoStateKey(service, 'image-upscaling:format'),
    'png',
  )
  // A new image (or none) drops the last result and cancels a pass running.
  const image = useImageSource({ onSourceChange: () => job.reset() })

  const run = async () => {
    if (!image.source || !available) return
    const settled = await job.start({
      file: image.source.file,
      outscale: Number(outscale),
      format,
    })
    // The upload itself failed: there is no task to show a result for.
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
            label="Upscaling"
            queued={phase === 'queued'}
            position={status?.position}
            percent={(status?.progress ?? 0) * 100}
            detail={
              status?.stage ??
              (status?.tiles_total && status.tiles_total > 1
                ? `${status.tiles_done ?? 0} of ${status.tiles_total} tiles`
                : undefined)
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
    if (phase === 'done' && jobId && job.result && image.source) {
      return (
        <ResultImage
          taskId={jobId}
          task={job.result}
          inputUrl={image.source.url}
          inputName={image.source.file.name}
          apiBase={service.apiBase}
        />
      )
    }
    return (
      <EmptyState
        icon={ImageUpscale}
        size="sm"
        description="The upscaled image will appear here, beside its input."
        className="py-8"
      />
    )
  })()

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <ImageSourcePanel
        inputMode={image.inputMode}
        onInputModeChange={image.setInputMode}
        source={image.source}
        onSource={image.setSource}
        webcam={image.webcam}
        onRun={() => void run()}
        isRunning={job.isActive}
        headerContent={
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <OutscaleSelect
                id="upscaling-image-outscale"
                scale={model.scale}
                value={outscale}
                onChange={setOutscale}
                disabled={job.isActive}
              />
              <div className="space-y-2">
                <Label
                  htmlFor="upscaling-format"
                  className="text-muted-foreground text-xs"
                >
                  Format
                </Label>
                <Select
                  value={format}
                  onValueChange={(v) => {
                    if (isFormat(v)) setFormat(v)
                  }}
                  disabled={job.isActive}
                >
                  <SelectTrigger
                    id="upscaling-format"
                    data-testid="upscaling-format"
                    className="w-full text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FORMAT_OPTIONS.map((f) => (
                      <SelectItem
                        key={f.value}
                        value={f.value}
                        className="text-xs"
                      >
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        }
        renderOverlay={(s) => (
          <div className="bg-muted/50 flex justify-center rounded-md">
            <RefImage
              src={s.url}
              alt="Image to upscale"
              className="max-h-80 w-auto max-w-full object-contain"
            />
          </div>
        )}
        dropZoneLabel="Drop an image to upscale"
        webcamDescription="Connect your webcam, then capture a frame to upscale."
        captureFilenamePrefix="upscaling-capture"
        runIcon={ImageUpscale}
        runLabel="Upscale"
        runningLabel="Upscaling…"
        testIdPrefix="upscaling"
      />
      <ConfigSection
        title="Result"
        className="border-border space-y-4 rounded-lg border p-4"
      >
        {result}
      </ConfigSection>
    </div>
  )
}

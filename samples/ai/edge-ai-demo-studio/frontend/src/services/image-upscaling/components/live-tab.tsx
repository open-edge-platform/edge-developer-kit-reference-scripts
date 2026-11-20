// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Pause, Play } from 'lucide-react'
import { useCallback, useRef } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'
import { RefImage } from '@/components/common/ref-media'
import { WebcamStream } from '@/components/common/webcam-stream'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useWebcamStream } from '@/hooks/use-webcam-stream'
import { useDemoRuntime } from '@/services/common/demo/demo-runtime'
import { demoStateKey } from '@/services/common/demo/demo-session'
import { useSessionState } from '@/services/common/demo/session-store'
import type { Service } from '@/services/types'
import type { UpscalingModel } from '../config'
import { type LiveStats, useLiveUpscale } from '../hooks'
import { effectiveOutscale, OutscaleSelect } from './upscale-options'

// Input widths to send: the model's work grows with the input's area, so a smaller frame is
// what keeps a heavier model live.
const INPUT_WIDTHS = ['160', '240', '320', '480', '640']

function Pane({
  label,
  url,
  pixelated,
  testId,
}: {
  label: string
  url: string | undefined
  /** Shows the input's pixels as they are, so the detail the model added stands out. */
  pixelated?: boolean
  testId: string
}) {
  return (
    <figure className="space-y-1.5">
      <div
        className="bg-muted/50 relative aspect-[4/3] overflow-hidden rounded-md"
        data-testid={testId}
      >
        {url && (
          <RefImage
            src={url}
            alt={label}
            className="absolute inset-0 h-full w-full object-contain"
            style={pixelated ? { imageRendering: 'pixelated' } : undefined}
          />
        )}
      </div>
      <figcaption className="text-muted-foreground text-xs">{label}</figcaption>
    </figure>
  )
}

function describeStats(stats: LiveStats): string {
  return [
    `${stats.fps.toFixed(1)} FPS`,
    `${Math.round(stats.latencyMs)} ms per frame`,
    stats.inferenceMs !== undefined &&
      `${Math.round(stats.inferenceMs)} ms in the model`,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function LiveTab({
  service,
  model,
}: {
  service: Service
  model: UpscalingModel
}) {
  const webcam = useWebcamStream()
  const { available } = useDemoRuntime()
  const [inputWidth, setInputWidth] = useSessionState(
    demoStateKey(service, 'image-upscaling:live-width'),
    '320',
  )
  const [savedOutscale, setOutscale] = useSessionState(
    demoStateKey(service, 'image-upscaling:live-outscale'),
    String(model.scale),
  )
  const outscale = effectiveOutscale(savedOutscale, model.scale)

  // The hook keeps its own ref to the <video>; the live loop reads frames from it.
  const videoNode = useRef<HTMLVideoElement | null>(null)
  const { videoRef } = webcam
  const trackVideo = useCallback(
    (node: HTMLVideoElement | null) => {
      videoNode.current = node
      videoRef(node)
    },
    [videoRef],
  )
  const video = useCallback(() => videoNode.current, [])

  const live = useLiveUpscale({
    apiBase: service.apiBase,
    video,
    inputWidth: Number(inputWidth),
    outscale: Number(outscale),
  })
  const { stats } = live

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="min-w-0 space-y-4">
        {!model.realtime && (
          <InlineNotice tone="warning" size="sm">
            This model is built for quality, not speed: a frame can take
            seconds. SPAN, the compact Real-ESRGAN models and Intel&apos;s Open
            Model Zoo model run live.
          </InlineNotice>
        )}
        <WebcamStream
          {...webcam}
          videoRef={trackVideo}
          title="Webcam"
          description="Each frame is scaled down to the input width, sent, and shown upscaled."
          previewClassName="min-h-[180px]"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label
              htmlFor="upscaling-live-width"
              className="text-muted-foreground text-xs"
            >
              Input width
            </Label>
            <Select value={inputWidth} onValueChange={setInputWidth}>
              <SelectTrigger
                id="upscaling-live-width"
                data-testid="upscaling-live-width"
                className="w-full text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INPUT_WIDTHS.map((w) => (
                  <SelectItem key={w} value={w} className="text-xs">
                    {w} px
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <OutscaleSelect
            id="upscaling-live-outscale"
            scale={model.scale}
            value={outscale}
            onChange={setOutscale}
          />
        </div>
        <Button
          className="w-full"
          disabled={!webcam.isReady || (!available && !live.running)}
          onClick={live.running ? live.stop : live.start}
          data-testid="upscaling-live-toggle"
        >
          {live.running ? (
            <Pause aria-hidden="true" className="h-4 w-4" />
          ) : (
            <Play aria-hidden="true" className="h-4 w-4" />
          )}
          {live.running ? 'Stop live upscaling' : 'Start live upscaling'}
        </Button>
        {live.error && (
          <InlineNotice tone="destructive" size="sm">
            Live upscaling stopped: {live.error}
          </InlineNotice>
        )}
      </div>
      <div className="min-w-0 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Pane
            label={
              stats
                ? `Input, ${stats.inputWidth}×${stats.inputHeight}`
                : 'Input'
            }
            url={live.frames?.input}
            pixelated
            testId="upscaling-live-input"
          />
          <Pane
            label={
              stats
                ? `Upscaled, ${stats.outputWidth}×${stats.outputHeight}`
                : 'Upscaled'
            }
            url={live.frames?.output}
            testId="upscaling-live-output"
          />
        </div>
        <p
          className="text-muted-foreground text-xs"
          role="status"
          data-testid="upscaling-live-stats"
        >
          {stats
            ? describeStats(stats)
            : live.running
              ? 'Waiting for the first frame…'
              : 'Start the webcam, then start live upscaling.'}
        </p>
      </div>
    </div>
  )
}

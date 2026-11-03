// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { toastError } from '@/lib/browser/toast-error'
import { useDemoRuntime } from '@/services/common/demo/demo-runtime'
import { demoStateKey } from '@/services/common/demo/demo-session'
import { useSessionState } from '@/services/common/demo/session-store'
import type { Service } from '@/services/types'
import { InterpolationResult } from './components/interpolation-result'
import { SourceVideoPanel } from './components/source-video-panel'
import { type InterpolationMode, useInterpolationJob } from './hooks'

export function FrameGenerationDemo({ service }: { service: Service }) {
  const [videoFile, setVideoFile] = useSessionState<File | null>(
    demoStateKey(service, 'frame-generation:video'),
    null,
  )
  const [multiplier, setMultiplier] = useSessionState(
    demoStateKey(service, 'frame-generation:multiplier'),
    '2',
  )
  const [mode, setMode] = useSessionState<InterpolationMode>(
    demoStateKey(service, 'frame-generation:mode'),
    'fps',
  )
  const job = useInterpolationJob(service)
  const { available } = useDemoRuntime()

  const handleVideoFileChange = (file: File | null) => {
    // Its result would no longer show, so cancel the task (an upload in flight is cancelled once
    // its task id arrives).
    job.reset()
    setVideoFile(file)
  }

  const handleSubmit = async () => {
    if (!videoFile || !available) return
    const settled = await job.start({
      videoFile,
      multiplier: Number(multiplier),
      mode,
    })
    // The upload itself failed: there is no task to show a result for.
    if (settled.phase === 'failed' && settled.jobId === null) {
      toastError('Failed to start interpolation')(settled.error)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-xs">
        Interpolate a video with RIFE: generate intermediate frames between
        every pair of consecutive frames, either to raise the frame rate or to
        create a smooth slow-motion version. Jobs are processed one at a time.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <SourceVideoPanel
          videoFile={videoFile}
          onVideoFileChange={handleVideoFileChange}
          mode={mode}
          onModeChange={setMode}
          multiplier={multiplier}
          onMultiplierChange={setMultiplier}
          phase={job.phase}
          available={available}
          onSubmit={() => void handleSubmit()}
        />
        <InterpolationResult job={job} apiBase={service.apiBase} />
      </div>
    </div>
  )
}

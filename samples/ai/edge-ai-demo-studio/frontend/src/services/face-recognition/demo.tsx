// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ServerOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useServiceLiveStatus } from '@/context/service-status-context'
import { useWebcamStream } from '@/hooks/use-webcam-stream'
import type { Service } from '@/services/types'
import { FaceGalleryPanel } from './components/face-gallery-panel'
import {
  FaceInputPanel,
  type FaceInputMode,
  type FaceSource,
} from './components/face-input-panel'
import { FaceResultsPanel } from './components/face-results-panel'
import { useRecognize } from './hooks'

export function FaceRecognitionDemo(_props: { service: Service }) {
  const status = useServiceLiveStatus('face-recognition')
  const isOnline = status === 'online'

  const webcam = useWebcamStream()
  const recognize = useRecognize()

  const [inputMode, setInputMode] = useState<FaceInputMode>('upload')
  const [source, setSource] = useState<FaceSource | null>(null)

  // Revoke the previous object URL when the source changes or the demo
  // unmounts, so repeated uploads/captures don't leak blob: URLs.
  useEffect(() => {
    const url = source?.url
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [source])

  const handleSource = (next: FaceSource | null) => {
    setSource(next)
    recognize.reset()
  }

  const run = () => {
    if (!source) return
    recognize.mutate(source.file)
  }

  // ── Service offline gate ───────────────────────────────────────────────────
  if (!isOnline) {
    return (
      <div className="p-6">
        <div className="text-muted-foreground flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
          <div className="bg-muted mb-3 flex h-16 w-16 items-center justify-center rounded-full">
            <ServerOff className="h-8 w-8" />
          </div>
          <h2 className="text-foreground text-base font-semibold">
            Face recognition service offline
          </h2>
          <p className="text-sm">
            Start the face-recognition worker to enroll and identify faces.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <FaceGalleryPanel isOnline={isOnline} />
        <div className="min-w-0 space-y-6">
          <FaceInputPanel
            inputMode={inputMode}
            onInputModeChange={setInputMode}
            source={source}
            onSource={handleSource}
            webcam={webcam}
            faces={recognize.data?.faces ?? []}
            onRun={run}
            isRunning={recognize.isPending}
          />
          <FaceResultsPanel
            result={recognize.data ?? null}
            isRunning={recognize.isPending}
            error={recognize.error}
          />
        </div>
      </div>
    </div>
  )
}

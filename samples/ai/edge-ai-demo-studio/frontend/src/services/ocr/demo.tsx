// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ServerOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useServiceLiveStatus } from '@/context/service-status-context'
import { useWebcamStream } from '@/hooks/use-webcam-stream'
import type { Service } from '@/services/types'
import {
  OcrInputPanel,
  type OcrSource,
  type OcrInputMode,
} from './components/ocr-input-panel'
import { OcrResultsPanel } from './components/ocr-results-panel'
import { useOcr, type OcrTask } from './hooks'

export function OcrDemo({ service }: { service: Service }) {
  const status = useServiceLiveStatus('ocr')
  const isOnline = status === 'online'

  // VL models (paddleocr-vl*) support a task selector; PP-OCR models ignore it.
  const currentModel = service.currentModel ?? service.defaultModel?.name ?? ''
  const isVlModel = currentModel.startsWith('paddleocr-vl')

  const webcam = useWebcamStream()
  const ocr = useOcr()

  const [inputMode, setInputMode] = useState<OcrInputMode>('upload')
  const [source, setSource] = useState<OcrSource | null>(null)
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null)
  const [task, setTask] = useState<OcrTask>('ocr')

  const regions = ocr.data?.regions ?? []

  // Revoke the previous object URL when the source changes or the demo
  // unmounts, so repeated uploads/captures don't leak blob: URLs.
  useEffect(() => {
    const url = source?.url
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [source])

  const handleSource = (next: OcrSource | null) => {
    setSource(next)
    ocr.reset()
    setHighlightIndex(null)
  }

  const run = () => {
    if (!source) return
    // Only send a task for VL models; PP-OCR models ignore it.
    ocr.mutate({ file: source.file, task: isVlModel ? task : undefined })
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
            OCR service offline
          </h2>
          <p className="text-sm">
            Start the OCR worker to scan images for text.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      {/* ── Work area ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <OcrInputPanel
          inputMode={inputMode}
          onInputModeChange={setInputMode}
          source={source}
          onSource={handleSource}
          webcam={webcam}
          isVlModel={isVlModel}
          task={task}
          onTaskChange={setTask}
          regions={regions}
          highlightIndex={highlightIndex}
          onRegionHover={setHighlightIndex}
          onRun={run}
          isRunning={ocr.isPending}
        />
        <OcrResultsPanel
          result={ocr.data ?? null}
          isRunning={ocr.isPending}
          error={ocr.error}
          highlightIndex={highlightIndex}
          onRegionHover={setHighlightIndex}
        />
      </div>
    </div>
  )
}

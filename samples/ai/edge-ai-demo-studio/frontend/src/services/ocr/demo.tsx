// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import { useImageSource } from '@/hooks/use-image-source'
import type { Service } from '@/services/types'
import { getEffectiveModel } from '@/types/service'
import { OcrInputPanel } from './components/ocr-input-panel'
import { OcrResultsPanel } from './components/ocr-results-panel'
import { describeOcrModel } from './config'
import { useOcrJob, useOcrLanguages, type OcrTask } from './hooks'

export function OcrDemo({ service }: { service: Service }) {
  const model = describeOcrModel(getEffectiveModel(service).name)
  const isVlModel = model.kind === 'vl'

  const ocr = useOcrJob(service.apiBase)
  // Only PP-OCR models have a recogniser to swap; VL models need no language catalogue.
  const languagesQuery = useOcrLanguages(service.apiBase, !isVlModel)
  const languages = languagesQuery.data?.available ?? []

  const [highlightIndex, setHighlightIndex] = useState<number | null>(null)
  const [task, setTask] = useState<OcrTask>('ocr')
  // null until the user picks one, so the worker's own default (which the
  // catalogue reports as `active`) is what runs until then.
  const [lang, setLang] = useState<string | null>(null)
  const selectedLang = lang ?? languagesQuery.data?.active ?? 'default'

  // A new image (or none) drops the last result and cancels a pass running.
  const image = useImageSource({
    onSourceChange: () => {
      ocr.reset()
      setHighlightIndex(null)
    },
  })

  const result = ocr.phase === 'done' ? ocr.result : null
  const regions = result?.regions ?? []

  const run = () => {
    if (!image.source) return
    // Send only the control that applies: a task for VL, a language for PP-OCR.
    ocr.start({
      file: image.source.file,
      task: isVlModel ? task : undefined,
      lang: isVlModel ? undefined : selectedLang,
    })
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <OcrInputPanel
          image={image}
          model={model}
          task={task}
          onTaskChange={setTask}
          languages={languages}
          lang={selectedLang}
          onLangChange={setLang}
          regions={regions}
          highlightIndex={highlightIndex}
          onRegionHover={setHighlightIndex}
          onRun={run}
          isRunning={ocr.isActive}
        />
        <OcrResultsPanel
          result={result}
          isRunning={ocr.isActive}
          partialText={ocr.status?.partial_text ?? ''}
          isCancelling={ocr.cancelling}
          isCancelled={ocr.phase === 'cancelled'}
          onCancel={ocr.cancel}
          error={ocr.phase === 'failed' ? ocr.error : null}
          highlightIndex={highlightIndex}
          onRegionHover={setHighlightIndex}
          sourceName={ocr.input?.file.name}
        />
      </div>
    </div>
  )
}

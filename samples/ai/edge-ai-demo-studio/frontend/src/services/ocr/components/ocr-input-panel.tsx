// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  ChartColumn,
  Languages,
  ScanText,
  Sigma,
  Table,
  type LucideIcon,
} from 'lucide-react'
import { ImageSourcePanel } from '@/components/common/image-source-panel'
import { TruncatedText } from '@/components/common/truncated-text'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { useImageSource } from '@/hooks/use-image-source'
import type { OcrModelSummary } from '../config'
import type { OcrLanguage, OcrRegion, OcrTask } from '../hooks'
import { OcrImageOverlay } from './ocr-image-overlay'

const OCR_TASK_OPTIONS: { value: OcrTask; label: string; icon: LucideIcon }[] =
  [
    { value: 'ocr', label: 'Text (OCR)', icon: ScanText },
    { value: 'table', label: 'Table recognition', icon: Table },
    { value: 'formula', label: 'Formula recognition', icon: Sigma },
    { value: 'chart', label: 'Chart recognition', icon: ChartColumn },
  ]

interface OcrInputPanelProps {
  /** The picked image and the webcam (`useImageSource`). */
  image: ReturnType<typeof useImageSource>
  /** The active model: a VL model takes a task, a PP-OCR one a language. */
  model: OcrModelSummary
  task: OcrTask
  onTaskChange: (task: OcrTask) => void
  /** Recognition languages from the worker; empty until they load. */
  languages: OcrLanguage[]
  lang: string
  onLangChange: (lang: string) => void
  regions: OcrRegion[]
  highlightIndex: number | null
  onRegionHover: (index: number | null) => void
  onRun: () => void
  isRunning: boolean
}

/** The image to read, under the model's one control: the task (VL) or the language (PP-OCR). */
export function OcrInputPanel({
  image,
  model,
  task,
  onTaskChange,
  languages,
  lang,
  onLangChange,
  regions,
  highlightIndex,
  onRegionHover,
  onRun,
  isRunning,
}: OcrInputPanelProps) {
  const selectedLanguage = languages.find((l) => l.key === lang)
  const isVlModel = model.kind === 'vl'

  const modelSummary = (
    <div
      className="border-border bg-muted/20 space-y-1 rounded-lg border p-3"
      data-testid="ocr-model-capabilities"
    >
      <div className="flex min-w-0 items-baseline gap-1.5 text-xs">
        <span className="text-muted-foreground shrink-0">Model</span>
        <TruncatedText text={model.label} className="font-medium" />
      </div>
      <p className="text-muted-foreground text-xs">{model.capabilities}</p>
    </div>
  )

  return (
    <ImageSourcePanel
      inputMode={image.inputMode}
      onInputModeChange={image.setInputMode}
      source={image.source}
      onSource={image.setSource}
      webcam={image.webcam}
      onRun={onRun}
      isRunning={isRunning}
      headerContent={
        <div className="space-y-3">
          {modelSummary}
          {isVlModel ? (
            <div className="space-y-2">
              <Label
                htmlFor="ocr-task-select"
                className="text-muted-foreground text-xs"
              >
                Task
              </Label>
              <Select
                value={task}
                onValueChange={(v) => {
                  const picked = OCR_TASK_OPTIONS.find((t) => t.value === v)
                  if (picked) onTaskChange(picked.value)
                }}
              >
                <SelectTrigger
                  id="ocr-task-select"
                  data-testid="ocr-task-select"
                  className="w-full text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OCR_TASK_OPTIONS.map((t) => (
                    <SelectItem
                      key={t.value}
                      value={t.value}
                      className="text-xs"
                    >
                      <t.icon aria-hidden="true" className="h-3.5 w-3.5" />
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* VL models read the script straight off the page: no language to pick. */}
            </div>
          ) : (
            languages.length > 0 && (
              <div className="space-y-2">
                <Label
                  htmlFor="ocr-language-select"
                  className="text-muted-foreground text-xs"
                >
                  Language
                </Label>
                <Select value={lang} onValueChange={onLangChange}>
                  <SelectTrigger
                    id="ocr-language-select"
                    data-testid="ocr-language-select"
                    className="w-full text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {languages.map((l) => (
                      <SelectItem key={l.key} value={l.key} className="text-xs">
                        <Languages aria-hidden="true" className="h-3.5 w-3.5" />
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedLanguage && (
                  <p className="text-muted-foreground text-xs">
                    {selectedLanguage.description}
                  </p>
                )}
              </div>
            )
          )}
        </div>
      }
      renderOverlay={(s) => (
        <OcrImageOverlay
          imageUrl={s.url}
          naturalWidth={s.naturalWidth}
          naturalHeight={s.naturalHeight}
          regions={regions}
          highlightIndex={highlightIndex}
          onRegionHover={onRegionHover}
        />
      )}
      dropZoneLabel="Drop an image to scan"
      webcamDescription="Connect your webcam, then capture a frame to run OCR on."
      captureFilenamePrefix="ocr-capture"
      runIcon={ScanText}
      runLabel="Run OCR"
      runningLabel="Scanning…"
      testIdPrefix="ocr"
    />
  )
}

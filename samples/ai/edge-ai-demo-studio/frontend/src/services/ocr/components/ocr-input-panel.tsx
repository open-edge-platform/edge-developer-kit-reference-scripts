// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  Camera,
  ChartColumn,
  FileImage,
  ImageUp,
  Loader2,
  RotateCcw,
  ScanText,
  Sigma,
  Table,
  type LucideIcon,
} from 'lucide-react'
import { useCallback } from 'react'
import { WebcamStream } from '@/components/common/webcam-stream'
import { FileDropZone } from '@/components/common/file-drop-zone'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { useWebcamStream } from '@/hooks/use-webcam-stream'
import type { OcrRegion, OcrTask } from '../hooks'
import { OcrImageOverlay } from './ocr-image-overlay'

export type OcrInputMode = 'upload' | 'webcam'

const OCR_TASK_OPTIONS: { value: OcrTask; label: string; icon: LucideIcon }[] =
  [
    { value: 'ocr', label: 'Text (OCR)', icon: ScanText },
    { value: 'table', label: 'Table recognition', icon: Table },
    { value: 'formula', label: 'Formula recognition', icon: Sigma },
    { value: 'chart', label: 'Chart recognition', icon: ChartColumn },
  ]

export interface OcrSource {
  url: string
  file: File
  naturalWidth: number
  naturalHeight: number
}

const ACCEPT = '.jpg,.jpeg,.png,.bmp,.tiff,.webp'
const MAX_BYTES = 10 * 1024 * 1024

function validateImage(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'Please choose an image file.'
  if (file.size > MAX_BYTES) return 'Image is larger than 10MB.'
  return null
}

/** Load an image File/URL and resolve its natural pixel dimensions. */
function loadImageSize(
  url: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Could not read image'))
    img.src = url
  })
}

function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, base64] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/png'
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], filename, { type: mime })
}

interface OcrInputPanelProps {
  inputMode: OcrInputMode
  onInputModeChange: (mode: OcrInputMode) => void
  source: OcrSource | null
  onSource: (source: OcrSource | null) => void
  webcam: ReturnType<typeof useWebcamStream>
  /** Whether the active model is a VL model that supports the task selector. */
  isVlModel: boolean
  task: OcrTask
  onTaskChange: (task: OcrTask) => void
  regions: OcrRegion[]
  highlightIndex: number | null
  onRegionHover: (index: number | null) => void
  onRun: () => void
  isRunning: boolean
}

export function OcrInputPanel({
  inputMode,
  onInputModeChange,
  source,
  onSource,
  webcam,
  isVlModel,
  task,
  onTaskChange,
  regions,
  highlightIndex,
  onRegionHover,
  onRun,
  isRunning,
}: OcrInputPanelProps) {
  const handleFile = useCallback(
    async (file: File | null) => {
      if (!file) {
        onSource(null)
        return
      }
      const url = URL.createObjectURL(file)
      const { width, height } = await loadImageSize(url)
      onSource({ url, file, naturalWidth: width, naturalHeight: height })
    },
    [onSource],
  )

  const handleCapture = useCallback(async () => {
    const dataUrl = webcam.captureImage()
    if (!dataUrl) return
    const file = dataUrlToFile(dataUrl, `ocr-capture-${Date.now()}.png`)
    const { width, height } = await loadImageSize(dataUrl)
    onSource({ url: dataUrl, file, naturalWidth: width, naturalHeight: height })
  }, [webcam, onSource])

  return (
    <div className="min-w-0 space-y-4">
      {isVlModel && (
        <div className="space-y-2">
          <Label
            htmlFor="ocr-task-select"
            className="text-muted-foreground text-xs"
          >
            Task
          </Label>
          <Select
            value={task}
            onValueChange={(v) => onTaskChange(v as OcrTask)}
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
                <SelectItem key={t.value} value={t.value} className="text-xs">
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <Tabs
        value={inputMode}
        onValueChange={(v) => {
          onInputModeChange(v as OcrInputMode)
          onSource(null)
        }}
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="upload">
            <ImageUp className="mr-2 h-4 w-4" />
            Upload Image
          </TabsTrigger>
          <TabsTrigger value="webcam">
            <Camera className="mr-2 h-4 w-4" />
            Webcam
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="mt-4">
          {source ? (
            <OcrImageOverlay
              imageUrl={source.url}
              naturalWidth={source.naturalWidth}
              naturalHeight={source.naturalHeight}
              regions={regions}
              highlightIndex={highlightIndex}
              onRegionHover={onRegionHover}
            />
          ) : (
            <FileDropZone
              file={null}
              onFileChange={handleFile}
              accept={ACCEPT}
              validate={validateImage}
              label="Drop an image to scan"
              maxSizeHint="Maximum file size: 10MB"
              fileIcon={FileImage}
              testId="ocr-file-input-zone"
              inputTestId="ocr-file-input"
            />
          )}
        </TabsContent>

        <TabsContent value="webcam" className="mt-4 space-y-3">
          {source ? (
            <OcrImageOverlay
              imageUrl={source.url}
              naturalWidth={source.naturalWidth}
              naturalHeight={source.naturalHeight}
              regions={regions}
              highlightIndex={highlightIndex}
              onRegionHover={onRegionHover}
            />
          ) : (
            <div className="min-h-[300px]">
              <WebcamStream
                videoRef={webcam.videoRef}
                isReady={webcam.isReady}
                error={webcam.error}
                startCamera={webcam.startCamera}
                stopCamera={webcam.stopCamera}
                devices={webcam.devices}
                selectedDeviceId={webcam.selectedDeviceId}
                listDevices={webcam.listDevices}
                title="Webcam"
                description="Connect your webcam, then capture a frame to run OCR on."
              />
            </div>
          )}

          {!source && (
            <Button
              onClick={handleCapture}
              disabled={!webcam.isReady}
              size="lg"
              className="w-full"
            >
              <Camera className="mr-2 h-4 w-4" />
              Capture Frame
            </Button>
          )}
        </TabsContent>
      </Tabs>

      {source && (
        <div className="flex items-center justify-between gap-3">
          {inputMode === 'webcam' ? (
            <Badge variant="secondary" className="gap-1.5">
              <FileImage className="h-3.5 w-3.5 shrink-0" />
              Captured frame
            </Badge>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="secondary" className="max-w-[220px] gap-1.5">
                  <FileImage className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{source.file.name}</span>
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="bottom">{source.file.name}</TooltipContent>
            </Tooltip>
          )}
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSource(null)}
              disabled={isRunning}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              {inputMode === 'webcam' ? 'Retake' : 'Change image'}
            </Button>
            <Button
              data-testid="ocr-run-button"
              onClick={onRun}
              disabled={isRunning}
            >
              {isRunning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ScanText className="mr-2 h-4 w-4" />
              )}
              {isRunning ? 'Scanning…' : 'Run OCR'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

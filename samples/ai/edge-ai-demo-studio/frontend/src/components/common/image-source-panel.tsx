// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  Camera,
  FileImage,
  ImageUp,
  Loader,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { FileDropZone } from '@/components/common/file-drop-zone'
import { InlineNotice } from '@/components/common/inline-notice'
import { WebcamStream } from '@/components/common/webcam-stream'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type {
  ImageSource,
  ImageSourceInputMode,
} from '@/hooks/use-image-source'
import type { useWebcamStream } from '@/hooks/use-webcam-stream'
import {
  dataUrlToFile,
  IMAGE_ACCEPT,
  loadImageSize,
  MAX_IMAGE_MB,
  validateImageFile,
} from '@/lib/browser/image-utils'

export type { ImageSource, ImageSourceInputMode }

export interface ImageSourcePanelProps {
  inputMode: ImageSourceInputMode
  onInputModeChange: (mode: ImageSourceInputMode) => void
  source: ImageSource | null
  onSource: (source: ImageSource | null) => void
  webcam: ReturnType<typeof useWebcamStream>
  onRun: () => void
  isRunning: boolean
  /** Rendered above the tabs (e.g. a model-specific task selector). */
  headerContent?: ReactNode
  /** Image + any annotations, once a source has been captured. */
  renderOverlay: (source: ImageSource) => ReactNode
  dropZoneLabel: string
  webcamDescription: string
  /** Prefix for the generated webcam-capture filename, e.g. "ocr-capture". */
  captureFilenamePrefix: string
  runIcon: LucideIcon
  runLabel: string
  runningLabel: string
  /** Prefix for this panel's data-testids, e.g. "ocr" or "face". */
  testIdPrefix: string
}

/**
 * Upload-or-webcam image source picker. Pair it with `useImageSource()`, which holds its state and
 * frees the object URLs it creates.
 */
export function ImageSourcePanel({
  inputMode,
  onInputModeChange,
  source,
  onSource,
  webcam,
  onRun,
  isRunning,
  headerContent,
  renderOverlay,
  dropZoneLabel,
  webcamDescription,
  captureFilenamePrefix,
  runIcon: RunIcon,
  runLabel,
  runningLabel,
  testIdPrefix,
}: ImageSourcePanelProps) {
  const [loadError, setLoadError] = useState<string | null>(null)
  // Reading an image's size is async: only the latest pick may become the
  // source, so a slow earlier one cannot replace a later one.
  const latestPick = useRef(0)

  const adopt = async (url: string, file: File) => {
    latestPick.current += 1
    const pick = latestPick.current
    setLoadError(null)
    try {
      const { width, height } = await loadImageSize(url)
      if (pick !== latestPick.current) throw new Error('superseded')
      onSource({ url, file, naturalWidth: width, naturalHeight: height })
    } catch {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
      if (pick === latestPick.current) {
        setLoadError(`Could not read ${file.name} as an image.`)
      }
    }
  }

  const handleFile = (file: File | null) => {
    if (!file) {
      clear()
      return
    }
    adopt(URL.createObjectURL(file), file)
  }

  const handleCapture = () => {
    const dataUrl = webcam.captureImage()
    if (!dataUrl) return
    const file = dataUrlToFile(
      dataUrl,
      `${captureFilenamePrefix}-${Date.now()}.png`,
    )
    adopt(dataUrl, file)
  }

  const clear = () => {
    latestPick.current += 1
    setLoadError(null)
    onSource(null)
  }

  const overlay = source && renderOverlay(source)

  return (
    <div className="min-w-0 space-y-4">
      {headerContent}

      <Tabs
        value={inputMode}
        onValueChange={(v) => {
          onInputModeChange(v === 'webcam' ? 'webcam' : 'upload')
          clear()
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
          {overlay ?? (
            <FileDropZone
              file={null}
              onFileChange={handleFile}
              accept={IMAGE_ACCEPT}
              validate={validateImageFile}
              label={dropZoneLabel}
              hint="or click to browse (JPG, PNG, BMP, TIFF, WEBP)"
              maxSizeHint={`Maximum file size: ${MAX_IMAGE_MB} MB`}
              fileIcon={FileImage}
              testId={`${testIdPrefix}-file-input-zone`}
              inputTestId={`${testIdPrefix}-file-input`}
            />
          )}
        </TabsContent>

        <TabsContent value="webcam" className="mt-4 space-y-3">
          {overlay ?? (
            <div className="min-h-[300px]">
              <WebcamStream
                {...webcam}
                title="Webcam"
                description={webcamDescription}
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

      {loadError && (
        <InlineNotice tone="destructive" size="sm">
          {loadError}
        </InlineNotice>
      )}

      {source && (
        <div className="flex flex-wrap items-center justify-between gap-3">
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
          <div className="ml-auto flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={clear}
              disabled={isRunning}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              {inputMode === 'webcam' ? 'Retake' : 'Change image'}
            </Button>
            <Button
              data-testid={`${testIdPrefix}-run-button`}
              onClick={onRun}
              disabled={isRunning}
            >
              {isRunning ? (
                <Loader className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RunIcon className="mr-2 h-4 w-4" />
              )}
              {isRunning ? runningLabel : runLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

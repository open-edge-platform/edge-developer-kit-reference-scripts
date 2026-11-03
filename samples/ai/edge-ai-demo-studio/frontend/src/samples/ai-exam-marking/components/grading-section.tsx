// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Camera, Printer, Settings2, Upload } from 'lucide-react'
import { useState } from 'react'
import { ImageDropZone } from '@/components/common/image-drop-zone'
import { WebcamStream } from '@/components/common/webcam-stream'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useWebcamStream } from '@/hooks/use-webcam-stream'
import { downloadUrl } from '@/lib/browser/download'
import { readFileAsDataUrl } from '@/lib/browser/image-utils'
import { toastError } from '@/lib/browser/toast-error'
import type { GradingSession } from '@/samples/ai-exam-marking/hooks/use-grading-session'
import {
  resizeImage,
  rotateImage,
} from '@/samples/ai-exam-marking/lib/image-utils'
import { buildGradingPdf } from '@/samples/ai-exam-marking/lib/pdf-report'
import { toSavedDataEntries } from '@/samples/ai-exam-marking/lib/records'
import type {
  DataEntry,
  GradingEntry,
  SavedRecord,
} from '@/samples/ai-exam-marking/lib/types'
import { AnswerSheetCard } from './answer-sheet-card'
import { GradingSettingsDialog } from './grading-settings-dialog'
import { HumanReviewDialog, type ReviewEntry } from './human-review-dialog'
import { ImagePreviewDialog, type PreviewEntry } from './image-preview-dialog'
import { ScannerPanel } from './scanner-panel'

/** The sample's fixed page size (US Letter at 72 dpi). */
const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792

type GradingSectionProps = {
  dataEntries: DataEntry[]
  /** The sheets and their queue — held above the tabs (`useGradingSession`). */
  grading: GradingSession
  saveRecord: (record: SavedRecord) => void
}

export function GradingSection({
  dataEntries,
  grading,
  saveRecord,
}: GradingSectionProps) {
  const { entries, updateEntry, removeEntry, addImage, retryEntry, prompts } =
    grading
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [previewEntry, setPreviewEntry] = useState<PreviewEntry | null>(null)
  const [reviewEntry, setReviewEntry] = useState<ReviewEntry | null>(null)

  const {
    devices,
    selectedDeviceId,
    videoRef,
    listDevices,
    startCamera,
    stopCamera,
    captureImage,
    isReady: webcamReady,
    error: webcamError,
  } = useWebcamStream()

  const handleFileSelect = async (file: File | null) => {
    if (!file) return
    try {
      const dataUrl = await readFileAsDataUrl(file)
      addImage(await resizeImage(dataUrl, PAGE_WIDTH, PAGE_HEIGHT))
    } catch (error) {
      toastError(`Could not read ${file.name}`)(error)
    }
  }

  const handleCapture = async () => {
    const imageSrc = captureImage()
    if (!imageSrc) return
    const rotated = await rotateImage(imageSrc, 270)
    addImage(await resizeImage(rotated, PAGE_WIDTH, PAGE_HEIGHT))
  }

  const handleDownload = (annotatedImage: string) =>
    downloadUrl(annotatedImage, `graded-${Date.now()}.png`)

  const handleExport = (entry: GradingEntry, label: string) => {
    const doc = buildGradingPdf({
      label,
      studentName: entry.studentName,
      studentId: entry.studentId,
      timestamp: new Date().toISOString(),
      dataEntries: toSavedDataEntries(dataEntries),
      ocrText: entry.ocrText ?? '',
      llmResults: entry.llmResults ?? [],
      annotatedImage: entry.annotatedImage,
    })
    doc.save(`grading-report-${entry.studentId || entry.id}.pdf`)
  }

  return (
    <div className="space-y-6">
      <GradingSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        {...prompts}
      />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>Add Answer Sheets</CardTitle>
            <CardDescription className="mt-1 text-xs">
              Upload or capture images — each will be graded automatically
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-xs"
            onClick={() => setIsSettingsOpen(true)}
          >
            <Settings2 className="h-4 w-4" aria-hidden />
            Edit Prompts
            <span className="sr-only">Grading settings</span>
          </Button>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="upload" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="upload" className="text-xs">
                <Upload className="mr-2 h-4 w-4" aria-hidden />
                Upload
              </TabsTrigger>
              <TabsTrigger value="webcam" className="text-xs">
                <Camera className="mr-2 h-4 w-4" aria-hidden />
                Camera
              </TabsTrigger>
              <TabsTrigger value="scanner" className="text-xs">
                <Printer className="mr-2 h-4 w-4" aria-hidden />
                Scanner
              </TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="mt-4">
              <ImageDropZone
                file={null}
                onFileChange={(file) => void handleFileSelect(file)}
                label="Click to upload or drag and drop"
                hint="PNG, JPG, JPEG up to 10MB"
                testId="grading-image-upload"
              />
            </TabsContent>

            {/* Mounted while another input is shown: a scanner connection
                keeps feeding the queue. */}
            <TabsContent
              value="scanner"
              forceMount
              className="mt-4 data-[state=inactive]:hidden"
            >
              <ScannerPanel onImage={addImage} />
            </TabsContent>

            <TabsContent value="webcam" className="mt-4">
              <WebcamStream
                videoRef={videoRef}
                isReady={webcamReady}
                error={webcamError}
                startCamera={startCamera}
                stopCamera={stopCamera}
                devices={devices}
                selectedDeviceId={selectedDeviceId}
                listDevices={listDevices}
              />
              {webcamReady && (
                <div className="mt-4 flex justify-center">
                  <Button
                    onClick={() => void handleCapture()}
                    className="flex-1"
                  >
                    <Camera className="mr-2 h-4 w-4" aria-hidden />
                    Capture Photo
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {entries.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {entries.map((entry, idx) => (
            <AnswerSheetCard
              key={entry.id}
              entry={entry}
              index={idx}
              onRemove={removeEntry}
              onRetry={retryEntry}
              onPreview={setPreviewEntry}
              onReview={setReviewEntry}
              onExport={handleExport}
            />
          ))}
        </div>
      )}

      <HumanReviewDialog
        reviewEntry={reviewEntry}
        setReviewEntry={setReviewEntry}
        dataEntries={dataEntries}
        llmPrompt={prompts.llmPrompt}
        updateEntry={updateEntry}
        saveRecord={saveRecord}
      />

      <ImagePreviewDialog
        entry={previewEntry}
        onClose={() => setPreviewEntry(null)}
        onDownload={handleDownload}
      />
    </div>
  )
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import Image from 'next/image'
import {
  ExternalLink,
  RotateCcw,
  ArrowLeft,
  AlertCircle,
  Loader2,
  Crop,
  ScanSearch,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useFeedback } from '../hooks'
import type { ClassificationResult, GetiConfig, AppView } from './types'

// ── Props ─────────────────────────────────────────────────────────────────────

interface GetiClassifierRefineProps {
  classificationResult: ClassificationResult
  getiConfig: GetiConfig
  isConnected: boolean
  workerLabels: string[]
  setCurrentView: (view: AppView) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GetiClassifierRefine({
  classificationResult,
  getiConfig,
  isConnected,
  workerLabels,
  setCurrentView,
}: GetiClassifierRefineProps) {
  const [selectedLabel, setSelectedLabel] = useState<string>('')

  const feedback = useFeedback()

  const handleSubmit = () => {
    if (!selectedLabel || !isConnected) return
    feedback.mutate({
      host: getiConfig.host,
      token: getiConfig.token,
      imageId: classificationResult.imageId,
      labelName: selectedLabel,
      isCorrect: false,
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ExternalLink className="text-primary h-5 w-5" />
          <CardTitle>Refine Label</CardTitle>
        </div>
        <CardDescription>
          Provide the correct label for the masked segment to improve
          model&apos;s accuracy in future training cycles.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {feedback.isSuccess ? (
          /* ── Success state ──────────────────────────────────────────────── */
          <div className="space-y-4 py-8 text-center">
            <p className="font-medium text-green-600 dark:text-green-400">
              Correction sent to Geti for fine-tuning
            </p>
            <p className="text-muted-foreground text-sm">
              Label submitted:{' '}
              <span className="font-medium capitalize">{selectedLabel}</span>
            </p>
            <p className="text-muted-foreground text-xs">
              The masked segment image was uploaded to Geti with the label.
            </p>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setCurrentView('upload')}
            >
              <RotateCcw className="h-4 w-4" />
              Classify Another Image
            </Button>
          </div>
        ) : (
          /* ── Main content ───────────────────────────────────────────────── */
          <div className="grid gap-8 md:grid-cols-2">
            {/* ── Left: images + metadata ─────────────────────────────────── */}
            <div className="space-y-4">
              {/* Display ID */}
              <div className="flex items-center justify-between">
                <span className="text-primary text-sm font-medium">
                  ID: {classificationResult.id}
                </span>
              </div>

              {/* ── Images: original on top, masked below ────────────────── */}
              <div className="space-y-3">
                {/* Original */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <ScanSearch className="text-muted-foreground h-3.5 w-3.5" />
                    <span className="text-muted-foreground text-xs font-medium">
                      Original
                    </span>
                  </div>
                  <div className="bg-muted/30 overflow-hidden rounded-lg border">
                    <Image
                      src={classificationResult.originalImageUrl}
                      alt="Original image"
                      width={400}
                      height={224}
                      className="mx-auto w-full object-contain"
                      style={{ maxHeight: '14rem' }}
                    />
                  </div>
                </div>

                {/* Masked */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Crop className="text-muted-foreground h-3.5 w-3.5" />
                    <span className="text-muted-foreground text-xs font-medium">
                      Segmentation Mask Applied
                    </span>
                  </div>
                  <div className="bg-muted/30 border-primary/40 overflow-hidden rounded-lg border-2">
                    <Image
                      src={classificationResult.croppedImageUrl}
                      alt="Masked segment"
                      width={400}
                      height={224}
                      className="mx-auto w-full object-contain"
                      style={{ maxHeight: '14rem' }}
                    />
                  </div>
                </div>
              </div>

              {/* ── Current prediction ───────────────────────────────────── */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/30 rounded-lg p-4">
                  <span className="text-muted-foreground mb-1 block text-xs font-medium tracking-wider uppercase">
                    Current Prediction
                  </span>
                  <span className="text-base font-medium capitalize">
                    {classificationResult.predictedLabel}
                  </span>
                </div>
                <div className="bg-muted/30 rounded-lg p-4">
                  <span className="text-muted-foreground mb-1 block text-xs font-medium tracking-wider uppercase">
                    Confidence
                  </span>
                  <span className="text-primary text-base font-medium">
                    {classificationResult.confidenceScore}%
                  </span>
                </div>
              </div>

              {/* ── Segmentation info ────────────────────────────────────── */}
              <div className="bg-muted/20 space-y-1.5 rounded-lg border p-3">
                <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Segment Info
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Objects</span>
                    <span className="font-medium">
                      {classificationResult.segmentation.num_objects ?? 1}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Masked Area</span>
                    <span className="font-medium">
                      {classificationResult.segmentation.area_px.toLocaleString()}{' '}
                      px²
                    </span>
                  </div>
                  {classificationResult.segmentation.labels.length > 0 && (
                    <div className="col-span-2 flex justify-between">
                      <span className="text-muted-foreground">Seg label</span>
                      <span className="font-medium capitalize">
                        {classificationResult.segmentation.labels[0].label}{' '}
                        <span className="text-muted-foreground">
                          (
                          {
                            classificationResult.segmentation.labels[0]
                              .confidence
                          }
                          %)
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Right: label selection ───────────────────────────────────── */}
            <div className="flex flex-col">
              {/* Geti not configured warning */}
              {!isConnected && (
                <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20">
                  <p className="flex items-center gap-2 text-sm text-yellow-800 dark:text-yellow-200">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    Configure Geti server in{' '}
                    <button
                      className="font-medium underline"
                      onClick={() => setCurrentView('settings')}
                    >
                      Settings
                    </button>{' '}
                    to send feedback.
                  </p>
                </div>
              )}

              {/* Feedback error */}
              {feedback.isError && (
                <div className="border-destructive/50 bg-destructive/10 text-destructive mb-4 rounded-lg border p-4">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    {feedback.error.message}
                  </p>
                </div>
              )}

              <div className="mb-8 space-y-3">
                <h3 className="font-medium">Correct Classification</h3>
                <p className="text-muted-foreground text-xs">
                  Select the correct label for the masked segment shown above.
                  This image will be uploaded to Geti for retraining.
                </p>

                {/* No labels warning */}
                {workerLabels.length === 0 ? (
                  <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20">
                    <p className="flex items-center gap-2 text-sm text-yellow-800 dark:text-yellow-200">
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                      No labels available. Make sure the worker is configured in{' '}
                      <button
                        className="font-medium underline"
                        onClick={() => setCurrentView('settings')}
                      >
                        Settings
                      </button>
                      .
                    </p>
                  </div>
                ) : (
                  <Select
                    value={selectedLabel}
                    onValueChange={setSelectedLabel}
                  >
                    <SelectTrigger className="bg-card h-14 text-base">
                      <SelectValue placeholder="Select the accurate label..." />
                    </SelectTrigger>
                    <SelectContent>
                      {workerLabels.map((label) => (
                        <SelectItem key={label} value={label}>
                          <span className="capitalize">{label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="mt-auto space-y-3">
                <Button
                  className="h-14 w-full gap-2 text-base font-medium"
                  onClick={handleSubmit}
                  disabled={
                    !selectedLabel ||
                    feedback.isPending ||
                    !isConnected ||
                    workerLabels.length === 0
                  }
                >
                  {feedback.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <RotateCcw className="h-4 w-4" />
                      Submit for Retraining
                    </>
                  )}
                </Button>

                <Button
                  variant="ghost"
                  className="w-full gap-2"
                  onClick={() => setCurrentView('result')}
                  disabled={feedback.isPending}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Result
                </Button>

                <p className="text-muted-foreground text-center text-xs">
                  The masked segment will be uploaded to Geti with your
                  corrected label to refine model weights in the next cycle.
                </p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

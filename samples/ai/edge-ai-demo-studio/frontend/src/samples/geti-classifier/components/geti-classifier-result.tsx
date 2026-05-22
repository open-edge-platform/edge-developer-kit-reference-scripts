// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import Image from 'next/image'
import {
  CheckCircle2,
  XCircle,
  BadgeCheck,
  AlertCircle,
  Loader2,
  RotateCcw,
  Crop,
  ScanSearch,
  Cpu,
  Scissors,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useFeedback } from '../hooks'
import type { ClassificationResult, GetiConfig, AppView } from './types'

// ── Props ─────────────────────────────────────────────────────────────────────

interface GetiClassifierResultProps {
  result: ClassificationResult
  getiConfig: GetiConfig
  isConnected: boolean
  workerLabels: string[]
  setCurrentView: (view: AppView) => void
}

// ── Colour helpers ────────────────────────────────────────────────────────────

function getLabelColour(label: string, workerLabels: string[]): string {
  const colours = [
    'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300',
    'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300',
    'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300',
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300',
    'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300',
  ]
  if (workerLabels.length === 0) return colours[2]
  const index = workerLabels
    .map((l) => l.toLowerCase())
    .indexOf(label.toLowerCase())
  return colours[index % colours.length] ?? colours[0]
}

function getBarColour(label: string, workerLabels: string[]): string {
  const colours = [
    'bg-red-500',
    'bg-green-500',
    'bg-blue-500',
    'bg-yellow-500',
    'bg-purple-500',
  ]
  if (workerLabels.length === 0) return colours[2]
  const index = workerLabels
    .map((l) => l.toLowerCase())
    .indexOf(label.toLowerCase())
  return colours[index % colours.length] ?? colours[0]
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GetiClassifierResult({
  result,
  getiConfig,
  isConnected,
  workerLabels,
  setCurrentView,
}: GetiClassifierResultProps) {
  const feedback = useFeedback()

  const handleConfirmCorrect = () => {
    if (!isConnected) return
    feedback.mutate({
      host: getiConfig.host,
      token: getiConfig.token,
      imageId: result.imageId,
      labelName: result.predictedLabel,
      isCorrect: true,
    })
  }

  return (
    <div className="space-y-4">
      {/* ── Page title row ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BadgeCheck className="text-primary h-5 w-5" />
          <h2 className="text-lg font-semibold">Classification Result</h2>
          <Badge variant="secondary" className="text-xs">
            {result.id}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground gap-2"
          onClick={() => setCurrentView('upload')}
        >
          <RotateCcw className="h-4 w-4" />
          New Image
        </Button>
      </div>

      {/* ── Main grid ────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* ══ Column 1: Images ══════════════════════════════════════════════════ */}
        <div className="space-y-4">
          {/* Original */}
          <Card>
            <CardHeader className="px-4 pt-4 pb-2">
              <div className="flex items-center gap-2">
                <ScanSearch className="text-muted-foreground h-4 w-4" />
                <CardTitle className="text-muted-foreground text-sm font-medium">
                  Original Image
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="bg-muted/30 overflow-hidden rounded-lg border">
                <Image
                  src={result.originalImageUrl}
                  alt="Original image"
                  width={400}
                  height={288}
                  className="w-full object-contain"
                  style={{ maxHeight: '18rem' }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Masked */}
          <Card>
            <CardHeader className="px-4 pt-4 pb-2">
              <div className="flex items-center gap-2">
                <Crop className="text-muted-foreground h-4 w-4" />
                <CardTitle className="text-muted-foreground text-sm font-medium">
                  Segmentation Mask Applied
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="bg-muted/30 border-primary/40 overflow-hidden rounded-lg border-2">
                <Image
                  src={result.croppedImageUrl}
                  alt="Masked segment"
                  width={400}
                  height={288}
                  className="w-full object-contain"
                  style={{ maxHeight: '18rem' }}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ══ Column 2: Predictions ═════════════════════════════════════════════ */}
        <div className="space-y-4">
          {/* Top prediction */}
          <Card>
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium tracking-wider uppercase">
                Prediction
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4">
              <div className="flex items-center justify-between">
                <Badge
                  variant="secondary"
                  className={cn(
                    'px-3 py-1 text-sm capitalize',
                    getLabelColour(result.predictedLabel, workerLabels),
                  )}
                >
                  {result.predictedLabel}
                </Badge>
                <span className="text-primary text-2xl font-bold">
                  {result.confidenceScore}%
                </span>
              </div>

              {/* Confidence bars */}
              <div className="space-y-2.5 pt-1">
                {result.allPredictions.map((pred) => (
                  <div key={pred.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium capitalize">
                        {pred.label}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {pred.confidence}%
                      </span>
                    </div>
                    <div className="bg-muted h-2 w-full rounded-full">
                      <div
                        className={cn(
                          'h-2 rounded-full transition-all duration-500',
                          getBarColour(pred.label, workerLabels),
                        )}
                        style={{ width: `${pred.confidence}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Segmentation info */}
          <Card>
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium tracking-wider uppercase">
                Segment Info
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="space-y-2">
                <div className="bg-muted/30 flex items-center justify-between rounded-lg px-3 py-2 text-sm">
                  <span className="text-muted-foreground">
                    Objects detected
                  </span>
                  <span className="font-semibold">
                    {result.segmentation.num_objects ?? 1}
                  </span>
                </div>
                <div className="bg-muted/30 flex items-center justify-between rounded-lg px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Masked area</span>
                  <span className="font-semibold tabular-nums">
                    {result.segmentation.area_px.toLocaleString()} px²
                  </span>
                </div>
                {result.segmentation.labels.length > 0 && (
                  <div className="bg-muted/30 flex items-center justify-between rounded-lg px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Seg label</span>
                    <span className="font-semibold capitalize">
                      {result.segmentation.labels[0].label}{' '}
                      <span className="text-muted-foreground font-normal">
                        ({result.segmentation.labels[0].confidence}%)
                      </span>
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Model + device info */}
          <Card>
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium tracking-wider uppercase">
                Pipeline Info
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="space-y-2">
                <div className="bg-muted/30 flex items-center justify-between rounded-lg px-3 py-2 text-sm">
                  <div className="text-muted-foreground flex items-center gap-1.5">
                    <Scissors className="h-3.5 w-3.5" />
                    <span>SEG model</span>
                  </div>
                  <span className="max-w-[140px] truncate text-right font-semibold">
                    {result.segModelName}
                    {result.segModelVersion != null
                      ? ` v${result.segModelVersion}`
                      : ''}
                  </span>
                </div>
                <div className="bg-muted/30 flex items-center justify-between rounded-lg px-3 py-2 text-sm">
                  <div className="text-muted-foreground flex items-center gap-1.5">
                    <BadgeCheck className="h-3.5 w-3.5" />
                    <span>CLS model</span>
                  </div>
                  <span className="max-w-[140px] truncate text-right font-semibold">
                    {result.clsModelName}
                    {result.clsModelVersion != null
                      ? ` v${result.clsModelVersion}`
                      : ''}
                  </span>
                </div>
                <div className="bg-muted/30 flex items-center justify-between rounded-lg px-3 py-2 text-sm">
                  <div className="text-muted-foreground flex items-center gap-1.5">
                    <Cpu className="h-3.5 w-3.5" />
                    <span>SEG device</span>
                  </div>
                  <span className="font-semibold">{result.segDevice}</span>
                </div>
                <div className="bg-muted/30 flex items-center justify-between rounded-lg px-3 py-2 text-sm">
                  <div className="text-muted-foreground flex items-center gap-1.5">
                    <Cpu className="h-3.5 w-3.5" />
                    <span>CLS device</span>
                  </div>
                  <span className="font-semibold">{result.clsDevice}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ══ Column 3: Feedback ════════════════════════════════════════════════ */}
        <div className="space-y-4">
          <Card className="h-full">
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium tracking-wider uppercase">
                Feedback
              </CardTitle>
              <CardDescription>
                Is this classification correct? Your feedback improves the next
                training cycle.
              </CardDescription>
            </CardHeader>

            <CardContent className="px-4 pb-4">
              {feedback.isSuccess ? (
                /* ── Success ──────────────────────────────────────────────── */
                <div className="flex flex-col items-center gap-4 py-6 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                    <CheckCircle2 className="h-7 w-7 text-green-600 dark:text-green-400" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-semibold text-green-700 dark:text-green-400">
                      Feedback submitted!
                    </p>
                    <p className="text-muted-foreground text-sm">
                      Sent to Geti for model enhancement
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="mt-2 w-full gap-2"
                    onClick={() => setCurrentView('upload')}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Classify Another Image
                  </Button>
                </div>
              ) : (
                /* ── Actions ──────────────────────────────────────────────── */
                <div className="space-y-4">
                  {/* Geti not configured warning */}
                  {!isConnected && (
                    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-900/20">
                      <p className="flex items-center gap-2 text-sm text-yellow-800 dark:text-yellow-200">
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                        Configure Geti in{' '}
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
                    <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-lg border p-3">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                        {feedback.error.message}
                      </p>
                    </div>
                  )}

                  {/* Current prediction summary */}
                  <div className="bg-muted/20 space-y-1 rounded-lg border p-4 text-center">
                    <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                      Predicted as
                    </p>
                    <p className="text-xl font-bold capitalize">
                      {result.predictedLabel}
                    </p>
                    <p className="text-primary text-sm font-semibold">
                      {result.confidenceScore}% confidence
                    </p>
                  </div>

                  {/* Confirm button */}
                  <Button
                    className="h-12 w-full gap-2"
                    onClick={handleConfirmCorrect}
                    disabled={feedback.isPending || !isConnected}
                  >
                    {feedback.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        Confirm Correct
                      </>
                    )}
                  </Button>

                  {/* Report incorrect button */}
                  <Button
                    variant="outline"
                    className="h-12 w-full gap-2"
                    onClick={() => setCurrentView('refine')}
                    disabled={feedback.isPending}
                  >
                    <XCircle className="h-4 w-4" />
                    Report Incorrect
                  </Button>

                  <p className="text-muted-foreground text-center text-xs">
                    Confirming uploads the masked image to Geti with the
                    predicted label. Reporting incorrect lets you pick the
                    label.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

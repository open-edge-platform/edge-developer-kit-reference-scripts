// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import NextImage from 'next/image'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Archive,
  Clock,
  Database,
  Download,
  Expand,
  FileImage,
  RefreshCw,
  ScanText,
  Sparkles,
  UserPen,
  X,
} from 'lucide-react'
import { describeStep } from '@/samples/ai-exam-marking/lib/marks'
import type {
  GradingEntry,
  ProcessingStep,
} from '@/samples/ai-exam-marking/lib/types'
import type { PreviewEntry } from './image-preview-dialog'
import type { ReviewEntry } from './human-review-dialog'

const STEP_ICON: Record<ProcessingStep['phase'], typeof Clock> = {
  queued: Clock,
  extracting: ScanText,
  grading: Sparkles,
  annotating: FileImage,
  saving: Database,
  archiving: Archive,
}

interface AnswerSheetCardProps {
  entry: GradingEntry
  index: number
  onRemove: (id: string) => void
  onRetry: (entry: GradingEntry) => void
  onPreview: (preview: PreviewEntry) => void
  onReview: (review: ReviewEntry) => void
  onExport: (entry: GradingEntry, label: string) => void
}

/** One answer sheet's card in the grading results grid. */
export function AnswerSheetCard({
  entry,
  index,
  onRemove,
  onRetry,
  onPreview,
  onReview,
  onExport,
}: AnswerSheetCardProps) {
  const entryLabel = `Answer Sheet - ${entry.studentId || entry.id}`
  const { step } = entry
  const StepIcon = step ? STEP_ICON[step.phase] : null

  return (
    <Card className="gap-2 overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{entryLabel}</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => onRemove(entry.id)}
          disabled={step !== null}
        >
          <X className="h-4 w-4" aria-hidden />
          <span className="sr-only">Remove</span>
        </Button>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {step && StepIcon ? (
          <div className="relative aspect-[3/4] overflow-hidden rounded-lg border">
            <NextImage
              src={entry.uploadedImage}
              alt="Processing"
              fill
              unoptimized
              className="scale-105 object-cover opacity-20 blur-sm"
            />
            <div className="from-background/60 to-background/95 absolute inset-0 bg-gradient-to-t" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-4">
              <div className="bg-background/90 ring-border/50 animate-pulse rounded-full p-3.5 shadow-md ring-1">
                <StepIcon
                  className={cn(
                    'h-5 w-5',
                    step.phase === 'queued'
                      ? 'text-muted-foreground'
                      : 'text-primary',
                  )}
                  aria-hidden
                />
              </div>
              <div className="space-y-2 text-center">
                <p
                  className="text-foreground text-xs font-medium"
                  role="status"
                >
                  {describeStep(step)}
                </p>
                {step.phase !== 'queued' && (
                  <div className="flex justify-center gap-1" aria-hidden>
                    <span className="bg-primary h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.3s]" />
                    <span className="bg-primary h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.15s]" />
                    <span className="bg-primary h-1.5 w-1.5 animate-bounce rounded-full" />
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : entry.error ? (
          <div className="relative aspect-[3/4] overflow-hidden rounded-lg border">
            <NextImage
              src={entry.uploadedImage}
              alt="Failed to process"
              fill
              unoptimized
              className="object-cover opacity-40"
            />
            <div className="from-background/60 to-background/95 absolute inset-0 bg-gradient-to-t" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
              <p className="text-destructive text-xs font-medium">
                {entry.error}
              </p>
              <Button
                size="sm"
                className="text-xs"
                onClick={() => onRetry(entry)}
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden />
                {entry.pendingRecord
                  ? 'Retry Saving'
                  : entry.pendingArchive
                    ? 'Retry Archiving'
                    : 'Retry Grading'}
              </Button>
            </div>
          </div>
        ) : entry.annotatedImage ? (
          <div className="overflow-hidden rounded-lg border">
            <NextImage
              src={entry.annotatedImage}
              alt={`Graded answer sheet ${index + 1}`}
              width={600}
              height={800}
              unoptimized
              className="h-auto w-full object-contain"
            />
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <NextImage
              src={entry.uploadedImage}
              alt={`Answer sheet ${index + 1}`}
              width={600}
              height={800}
              unoptimized
              className="h-auto w-full object-contain"
            />
          </div>
        )}
      </CardContent>

      {entry.annotatedImage && step === null && (
        <CardFooter className="grid gap-1.5 px-4">
          <div className="grid grid-cols-3 gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() =>
                onPreview({
                  image: entry.annotatedImage,
                  label: entryLabel,
                  overlay: entry.overlayImage,
                })
              }
              aria-label={`Preview ${entryLabel}`}
              title="Preview"
            >
              <Expand className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={
                !entry.reviewed && entry.llmResults?.some((r) => r.humanReview)
                  ? 'text-destructive hover:text-destructive border-destructive/40 hover:bg-destructive/10 text-xs'
                  : 'text-xs'
              }
              onClick={() =>
                onReview({
                  entryId: entry.id,
                  uploadedImage: entry.uploadedImage,
                  label: entryLabel,
                  ocrText: entry.ocrText ?? '',
                  llmResults: entry.llmResults
                    ? entry.llmResults.map((r) => ({ ...r }))
                    : [],
                  studentName: entry.studentName,
                  studentId: entry.studentId,
                  sourceFilename: entry.sourceFilename,
                })
              }
              aria-label={`Review ${entryLabel}`}
              title="Human review"
            >
              <UserPen className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => onExport(entry, entryLabel)}
              aria-label={`Export PDF ${entryLabel}`}
              title="Export PDF"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        </CardFooter>
      )}
    </Card>
  )
}

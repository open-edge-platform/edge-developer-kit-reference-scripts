// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type React from 'react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ClipboardList, Loader, ScanText, Sparkles } from 'lucide-react'
import { InlineNotice } from '@/components/common/inline-notice'
import {
  buildAnnotatedImage,
  MARKING_DATA_DIR,
} from '@/samples/ai-exam-marking/lib/image-utils'
import { withRunningTotals } from '@/samples/ai-exam-marking/lib/marks'
import {
  buildArchiveRequest,
  buildSavedRecord,
} from '@/samples/ai-exam-marking/lib/records'
import {
  SUBJECTS,
  type ArchiveRequest,
  type DataEntry,
  type GradingEntry,
  type LLMResultEntry,
  type SavedRecord,
  type Subject,
} from '@/samples/ai-exam-marking/lib/types'

export interface ReviewEntry {
  entryId: string
  uploadedImage: string
  label: string
  ocrText: string
  llmResults: LLMResultEntry[]
  studentName?: string
  studentId?: string
  sourceFilename?: string
}

interface HumanReviewDialogProps {
  reviewEntry: ReviewEntry | null
  setReviewEntry: React.Dispatch<React.SetStateAction<ReviewEntry | null>>
  dataEntries: DataEntry[]
  subject: Subject
  llmPrompt: string
  updateEntry: (id: string, patch: Partial<GradingEntry>) => void
  /** Resolves false when the exam database did not store the record. */
  saveRecord: (record: SavedRecord) => Promise<boolean>
  /** Resolves false when the agent did not store the annotated image. */
  archiveEntry: (entryId: string, req: ArchiveRequest) => Promise<boolean>
}

export function HumanReviewDialog({
  reviewEntry,
  setReviewEntry,
  dataEntries,
  subject,
  llmPrompt,
  updateEntry,
  saveRecord,
  archiveEntry,
}: HumanReviewDialogProps) {
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  const close = () => {
    setReviewEntry(null)
    setReviewError(null)
  }

  const handleRegenerate = async () => {
    if (!reviewEntry) return
    setIsRegenerating(true)
    setReviewError(null)
    try {
      // Edited marks move the running totals the record and the dashboard
      // read; the AI's totals would be stale.
      const llmResults = withRunningTotals(reviewEntry.llmResults)
      const { annotated: annotatedImage, overlay: overlayImage } =
        await buildAnnotatedImage(
          reviewEntry.uploadedImage,
          llmResults,
          dataEntries,
          MARKING_DATA_DIR,
        )
      updateEntry(reviewEntry.entryId, {
        annotatedImage,
        overlayImage,
        llmResults,
      })
      const saved = await saveRecord(
        buildSavedRecord({
          entryId: reviewEntry.entryId,
          studentName: reviewEntry.studentName,
          studentId: reviewEntry.studentId,
          subjectId: SUBJECTS[subject][0],
          dataEntries,
          ocrText: reviewEntry.ocrText,
          overlayImage,
          annotatedImage,
          llmPrompt,
          llmResults,
        }),
      )
      if (!saved) {
        setReviewError(
          'Saving the reviewed result failed. Your edits are kept — click Regenerate to retry.',
        )
        return
      }

      // Moves the paper if an earlier save failed; otherwise falls back to storing only.
      const archived = await archiveEntry(
        reviewEntry.entryId,
        buildArchiveRequest({
          entryId: reviewEntry.entryId,
          sourceFilename: reviewEntry.sourceFilename,
          annotatedImage,
          studentId: reviewEntry.studentId,
          subject,
        }),
      )
      if (!archived) {
        setReviewError(
          'Storing the reviewed image failed, so results would be sent with the old image. Click Regenerate to retry.',
        )
        return
      }

      updateEntry(reviewEntry.entryId, {
        reviewed: true,
        pendingRecord: undefined,
      })
      close()
    } catch {
      setReviewError(
        'Regenerating the annotations failed. Click Regenerate to retry.',
      )
    } finally {
      setIsRegenerating(false)
    }
  }

  /** Applies `patch` to the result in row `index` of the review. */
  const editResult = (index: number, patch: Partial<LLMResultEntry>) =>
    setReviewEntry((prev) =>
      prev
        ? {
            ...prev,
            llmResults: prev.llmResults.map((item, i) =>
              i === index ? { ...item, ...patch } : item,
            ),
          }
        : prev,
    )

  return (
    <Dialog
      open={reviewEntry !== null}
      onOpenChange={(open) => !open && close()}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" aria-hidden />
            {reviewEntry?.label} — Human Review
          </DialogTitle>
          <DialogDescription className="text-xs">
            Extracted OCR text and AI grading results for manual verification.
            Edit marks or feedback then click Regenerate.
          </DialogDescription>
        </DialogHeader>
        {reviewEntry && (
          <Tabs defaultValue="grading" className="mt-2">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="ocr" className="gap-2 text-xs">
                <ScanText className="h-3.5 w-3.5" aria-hidden />
                OCR Text
              </TabsTrigger>
              <TabsTrigger value="grading" className="gap-2 text-xs">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Grading Results
              </TabsTrigger>
            </TabsList>
            <TabsContent value="ocr" className="mt-3">
              <pre className="bg-muted max-h-[60vh] overflow-auto rounded-lg p-4 text-xs break-words whitespace-pre-wrap">
                {reviewEntry.ocrText || 'No OCR text available.'}
              </pre>
            </TabsContent>
            <TabsContent value="grading" className="mt-3 space-y-3">
              <div className="max-h-[50vh] overflow-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Q</th>
                      <th className="px-3 py-2 text-left font-medium">
                        Answer
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        Feedback
                      </th>
                      <th className="px-3 py-2 text-left font-medium">Marks</th>
                      <th className="px-3 py-2 text-left font-medium">
                        Review
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewEntry.llmResults.map((r, rIdx) => (
                      <tr key={r.questionNumber} className="border-t">
                        <td className="px-3 py-2 font-medium">
                          {r.questionNumber}
                        </td>
                        <td className="max-w-[180px] px-3 py-2 whitespace-pre-wrap">
                          {r.extractedAnswer}
                        </td>
                        <td className="max-w-[200px] px-3 py-2">
                          <Textarea
                            className="min-h-[60px] text-xs"
                            aria-label={`Feedback for question ${r.questionNumber}`}
                            value={r.feedback}
                            onChange={(e) =>
                              editResult(rIdx, { feedback: e.target.value })
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-1 whitespace-nowrap">
                            <Input
                              type="number"
                              min={0}
                              max={r.marks.max ?? undefined}
                              step="any"
                              className="h-7 w-16 text-xs"
                              aria-label={`Marks awarded for question ${r.questionNumber}`}
                              placeholder="-"
                              value={r.marks.awarded ?? ''}
                              onChange={(e) => {
                                const { value, valueAsNumber } = e.target
                                if (value !== '' && Number.isNaN(valueAsNumber))
                                  return
                                editResult(rIdx, {
                                  marks: {
                                    ...r.marks,
                                    awarded:
                                      value === '' ? null : valueAsNumber,
                                  },
                                })
                              }}
                            />
                            <span className="text-muted-foreground">
                              / {r.marks.max ?? 'N/A'}
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {r.humanReview ? (
                            <span className="text-destructive font-semibold">
                              Yes
                            </span>
                          ) : (
                            <span className="text-muted-foreground">No</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {reviewError && (
                <InlineNotice tone="destructive" size="sm">
                  {reviewError}
                </InlineNotice>
              )}
              <Button
                className="w-full text-xs"
                disabled={isRegenerating}
                onClick={handleRegenerate}
              >
                {isRegenerating ? (
                  <>
                    <Loader className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    Regenerating…
                  </>
                ) : (
                  <>
                    <ScanText className="mr-2 h-4 w-4" aria-hidden />
                    Regenerate Annotations
                  </>
                )}
              </Button>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

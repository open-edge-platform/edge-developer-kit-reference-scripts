// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertCircle, ImageIcon } from 'lucide-react'
import Image from 'next/image'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatMarks, formatTotal } from '@/samples/ai-exam-marking/lib/marks'
import type { SavedRecord } from '@/samples/ai-exam-marking/lib/types'

/** A saved result in full: the sheet, the marking scheme, OCR text and grading. */
export function RecordDetailDialog({
  record,
  onClose,
}: {
  record: SavedRecord | null
  onClose: () => void
}) {
  return (
    <Dialog open={record !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85svh] max-w-2xl flex-col overflow-hidden">
        {record && (
          <>
            <DialogHeader>
              <DialogTitle>Record Details</DialogTitle>
              <DialogDescription>
                Saved on {new Date(record.timestamp).toLocaleString()}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 overflow-y-auto pr-1">
              {record.ocrResult.imagePreview && (
                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <ImageIcon className="h-4 w-4" aria-hidden />
                    Uploaded/Captured Image
                  </h3>
                  <Image
                    src={record.ocrResult.imagePreview}
                    alt="Captured"
                    width={0}
                    height={0}
                    sizes="100vw"
                    className="max-h-64 w-full rounded-lg border object-contain"
                    unoptimized
                  />
                </section>
              )}

              <section>
                <h3 className="mb-2 text-sm font-medium">Marking Scheme</h3>
                <div className="space-y-3">
                  {record.dataEntries.map((entry, idx) => (
                    <div
                      key={idx}
                      className="bg-muted/30 rounded-lg border p-3"
                    >
                      <p className="mb-1 text-xs font-medium">
                        Question {entry.number}
                      </p>
                      <p className="mb-1 text-xs">{entry.question}</p>
                      <div className="text-muted-foreground flex gap-4 text-xs">
                        <span>Marks: {entry.marks}</span>
                        <span>Scheme: {entry.scheme}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-medium">OCR Extracted Text</h3>
                <div className="bg-muted/30 rounded-lg border p-4">
                  <p className="text-xs whitespace-pre-wrap">
                    {record.ocrResult.text}
                  </p>
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-medium">
                  LLM Grading Analysis
                </h3>
                <div className="space-y-4">
                  {record.llmResult.response.map((entry, idx) => (
                    <div key={idx} className="bg-card rounded-lg border p-4">
                      <div className="mb-3 flex items-start justify-between">
                        <h4 className="text-xs font-semibold">
                          Question {entry.questionNumber}
                        </h4>
                        <div className="flex items-center gap-2">
                          <Badge tone="primary" className="px-3 py-1">
                            {formatMarks(entry.marks)}
                          </Badge>
                          {entry.humanReview && (
                            <Badge tone="warning" className="px-3 py-1">
                              <AlertCircle aria-hidden />
                              Review
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                            Student Answer
                          </p>
                          <p className="text-xs leading-relaxed">
                            {entry.extractedAnswer}
                          </p>
                        </div>

                        <div>
                          <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                            Feedback
                          </p>
                          <p className="text-muted-foreground text-xs leading-relaxed">
                            {entry.feedback}
                          </p>
                        </div>

                        <div className="flex items-center justify-between border-t pt-3 text-xs">
                          <span className="text-muted-foreground">
                            Running Total:
                          </span>
                          <span className="font-semibold">
                            {formatTotal(entry.runningTotal)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

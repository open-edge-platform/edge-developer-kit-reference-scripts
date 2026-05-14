// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  FileText,
  Calendar,
  ImageIcon,
  Trash2,
  Download,
  AlertCircle,
} from 'lucide-react'
import Image from 'next/image'
import { jsPDF } from 'jspdf'
import type { SavedRecord } from '@/lib/ai-exam-marking/types'

type HistoryViewProps = {
  records: SavedRecord[]
  deleteRecord: (id: string) => boolean
  deleteAllRecords: () => void
}

export function HistoryView({
  records,
  deleteRecord,
  deleteAllRecords,
}: HistoryViewProps) {
  const [selectedRecord, setSelectedRecord] = useState<SavedRecord | null>(null)

  const handleDelete = (id: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()

    if (!confirm('Are you sure you want to delete this record?')) {
      return
    }

    deleteRecord(id)
    if (selectedRecord?.id === id) {
      setSelectedRecord(null)
    }
  }

  const handleDeleteAll = () => {
    if (
      !confirm(
        `Are you sure you want to delete all ${records.length} records? This action cannot be undone.`,
      )
    ) {
      return
    }

    // Double confirmation for safety
    if (
      !confirm(
        'This will permanently delete all saved results. Are you absolutely sure?',
      )
    ) {
      return
    }

    deleteAllRecords()
    setSelectedRecord(null)
  }

  const buildPdf = (record: SavedRecord): jsPDF => {
    const doc = new jsPDF()
    const margin = 14
    const pageWidth = doc.internal.pageSize.getWidth()
    const maxWidth = pageWidth - margin * 2
    let y = 20

    const addText = (text: string, size = 10, bold = false) => {
      doc.setFontSize(size)
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      const lines = doc.splitTextToSize(text, maxWidth)
      for (const line of lines) {
        if (y > 275) {
          doc.addPage()
          y = 20
        }
        doc.text(line, margin, y)
        y += size * 0.5
      }
      y += 2
    }

    addText(`Grading Report`, 16, true)
    addText(`Saved: ${new Date(record.timestamp).toLocaleString()}`, 9)
    y += 4

    addText('Marking Scheme', 13, true)
    for (const entry of record.dataEntries) {
      addText(
        `Q${entry.number}: ${entry.question} (${entry.marks} marks)`,
        10,
        true,
      )
      addText(`Scheme: ${entry.scheme}`, 9)
      y += 2
    }

    addText('OCR Extracted Text', 13, true)
    addText(record.ocrResult.text, 9)
    y += 4

    addText('LLM Grading Analysis', 13, true)
    for (const entry of record.llmResult.response) {
      addText(
        `Question ${entry.questionNumber} — ${entry.marksAwardedOverMaxMarks}`,
        11,
        true,
      )
      addText(`Student Answer: ${entry.extractedAnswer}`, 9)
      addText(`Feedback: ${entry.feedback}`, 9)
      addText(
        `Running Total: ${entry.marksAccumulatedOverMaxMarksAccumulated}${entry.humanReview ? ' ⚠ Human Review' : ''}`,
        9,
      )
      y += 3
    }

    if (record.ocrResult.imagePreview?.startsWith('data:image/png')) {
      try {
        doc.addPage()
        y = 20
        addText('Annotated Image', 13, true)
        const imgData = record.ocrResult.imagePreview
        const imgProps = doc.getImageProperties(imgData)
        const imgWidth = maxWidth
        const imgHeight = (imgProps.height / imgProps.width) * imgWidth
        doc.addImage(
          imgData,
          'PNG',
          margin,
          y,
          imgWidth,
          Math.min(imgHeight, 200),
        )
      } catch {
        // skip image if it fails
      }
    }

    return doc
  }

  const handleExport = (
    record: SavedRecord,
    e: React.MouseEvent<HTMLButtonElement>,
  ) => {
    e.stopPropagation()
    const doc = buildPdf(record)
    doc.save(`grading-result-${record.id.slice(-8)}.pdf`)
  }

  const handleExportAll = () => {
    records.forEach((record, idx) => {
      const doc = buildPdf(record)
      doc.save(`grading-result-${idx + 1}-${record.id.slice(-8)}.pdf`)
    })
  }

  if (records.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Saved Results</CardTitle>
          <CardDescription className="text-xs">
            No saved results yet
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center text-xs">
            Process some images with OCR and LLM to see results here.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <CardTitle>Saved Results</CardTitle>
              <CardDescription className="text-xs">
                View the previous OCR and LLM grading results
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleExportAll}
                variant="outline"
                size="sm"
                className="text-xs"
              >
                <Download className="mr-2 h-4 w-4" />
                Export All
              </Button>
              <Button
                onClick={handleDeleteAll}
                variant="outline"
                size="sm"
                className="text-xs"
              >
                <Trash2 className="text-destructive mr-2 h-4 w-4" />
                Delete All
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 text-sm">
            {records.map((record) => (
              <div
                key={record.id}
                className="bg-card hover:bg-muted/50 cursor-pointer rounded-lg border p-4 transition-colors"
                onClick={() => setSelectedRecord(record)}
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <FileText className="text-muted-foreground h-4 w-4" />
                      <p className="font-medium">
                        Record {record.id.slice(-8)}
                      </p>
                    </div>
                    <div className="text-muted-foreground flex items-center gap-2 text-sm text-xs">
                      <Calendar className="h-3 w-3" />
                      {new Date(record.timestamp).toLocaleString()}
                    </div>
                    <p className="text-muted-foreground text-sm text-xs">
                      {record.dataEntries.length} questions •{' '}
                      {record.llmResult.response.length} results
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      aria-label="Export Record"
                      variant="outline"
                      size="sm"
                      onClick={(e) => handleExport(record, e)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      aria-label="Delete Record"
                      variant="outline"
                      size="sm"
                      onClick={(e) => handleDelete(record.id, e)}
                    >
                      <Trash2 className="text-destructive h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {selectedRecord && (
        <Dialog
          open={!!selectedRecord}
          onOpenChange={(open) => !open && setSelectedRecord(null)}
        >
          <DialogContent className="flex max-h-[85svh] max-w-2xl flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle>Record Details</DialogTitle>
              <DialogDescription>
                Saved on {new Date(selectedRecord.timestamp).toLocaleString()}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 overflow-y-auto pr-1">
              {selectedRecord.ocrResult.imagePreview && (
                <div>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <ImageIcon className="h-4 w-4" />
                    Uploaded/Captured Image
                  </h3>
                  <Image
                    src={selectedRecord.ocrResult.imagePreview}
                    alt="Captured"
                    width={0}
                    height={0}
                    sizes="100vw"
                    className="max-h-64 w-full rounded-lg border object-contain"
                    unoptimized
                  />
                </div>
              )}

              <div>
                <h3 className="mb-2 text-sm font-medium">Marking Scheme</h3>
                <div className="space-y-3">
                  {selectedRecord.dataEntries.map((entry, idx) => (
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
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium">OCR Extracted Text</h3>
                <div className="bg-muted/30 rounded-lg border p-4">
                  <p className="text-xs whitespace-pre-wrap">
                    {selectedRecord.ocrResult.text}
                  </p>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium">
                  LLM Grading Analysis
                </h3>
                <div className="space-y-4">
                  {selectedRecord.llmResult.response.map((entry, idx) => (
                    <div key={idx} className="bg-card rounded-lg border p-4">
                      <div className="mb-3 flex items-start justify-between">
                        <h4 className="text-xs font-semibold">
                          Question {entry.questionNumber}
                        </h4>
                        <div className="flex items-center gap-2">
                          <span className="bg-primary/10 text-primary rounded-full px-3 py-1 text-xs font-medium">
                            {entry.marksAwardedOverMaxMarks}
                          </span>
                          {entry.humanReview && (
                            <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-600">
                              <AlertCircle className="h-3 w-3" />
                              Review
                            </span>
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
                            {entry.marksAccumulatedOverMaxMarksAccumulated}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Calendar, Download, FileText, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { plural } from '@/lib/browser/format'
import {
  buildCombinedGradingPdf,
  buildGradingPdf,
  type GradingPdfInput,
} from '@/samples/ai-exam-marking/lib/pdf-report'
import type { SavedRecord } from '@/samples/ai-exam-marking/lib/types'
import type { ExamRole } from '../hooks/use-exam-role'
import { RecordDetailDialog } from './record-detail-dialog'

const toPdfInput = (record: SavedRecord): GradingPdfInput => ({
  studentName: record.studentName,
  studentId: record.studentId,
  timestamp: record.timestamp,
  dataEntries: record.dataEntries,
  ocrText: record.ocrResult.text,
  llmResults: record.llmResult.response,
  annotatedImage: record.ocrResult.imagePreview,
})

/** What a confirmed delete removes: one record, or every record. */
type PendingDelete = { record: SavedRecord } | 'all'

export function HistoryView({
  role,
  studentId,
  records,
  deleteRecord,
  deleteAllRecords,
}: {
  role: ExamRole
  studentId?: string
  records: SavedRecord[]
  deleteRecord: (id: string) => void
  deleteAllRecords: () => void
}) {
  const [selectedRecord, setSelectedRecord] = useState<SavedRecord | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)

  const visibleRecords =
    role === 'student' && studentId
      ? records.filter((r) => r.studentId === studentId)
      : records

  const confirmDelete = () => {
    if (pendingDelete === 'all') {
      deleteAllRecords()
      setSelectedRecord(null)
    } else if (pendingDelete) {
      deleteRecord(pendingDelete.record.id)
      if (selectedRecord?.id === pendingDelete.record.id) {
        setSelectedRecord(null)
      }
    }
  }

  const handleExport = (record: SavedRecord) => {
    buildGradingPdf(toPdfInput(record)).save(
      `grading-result-${record.studentId || record.id}.pdf`,
    )
  }

  const handleExportAll = () => {
    buildCombinedGradingPdf(visibleRecords.map(toPdfInput)).save(
      'grading-results.pdf',
    )
  }

  if (visibleRecords.length === 0) {
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
            {role === 'student'
              ? 'No grading results found for your student ID.'
              : 'Process some images with OCR and LLM to see results here.'}
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
                <Download className="mr-2 h-4 w-4" aria-hidden />
                Export All
              </Button>
              {role === 'teacher' && (
                <Button
                  onClick={() => setPendingDelete('all')}
                  variant="outline"
                  size="sm"
                  className="text-xs"
                >
                  <Trash2
                    className="text-destructive mr-2 h-4 w-4"
                    aria-hidden
                  />
                  Delete All
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {visibleRecords.map((record) => (
              <li
                key={record.id}
                className="bg-card hover:bg-muted/50 flex items-start justify-between gap-2 rounded-lg border transition-colors"
              >
                <button
                  type="button"
                  className="focus-visible:ring-ring min-w-0 flex-1 space-y-1 rounded-lg p-4 text-left focus-visible:ring-2 focus-visible:outline-none"
                  onClick={() => setSelectedRecord(record)}
                >
                  <span className="flex items-center gap-2">
                    <FileText
                      className="text-muted-foreground h-4 w-4"
                      aria-hidden
                    />
                    <span className="font-medium">
                      {record.studentId ?? `Record ${record.id}`}
                    </span>
                    {record.studentName && (
                      <span className="text-muted-foreground text-xs">
                        — {record.studentName}
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground flex items-center gap-2 text-xs">
                    <Calendar className="h-3 w-3" aria-hidden />
                    {new Date(record.timestamp).toLocaleString()}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {plural(record.dataEntries.length, 'question')} •{' '}
                    {plural(record.llmResult.response.length, 'result')}
                  </span>
                </button>
                <div className="flex gap-2 p-4 pl-0">
                  <Button
                    aria-label="Export Record"
                    variant="outline"
                    size="sm"
                    onClick={() => handleExport(record)}
                  >
                    <Download className="h-4 w-4" aria-hidden />
                  </Button>
                  {role === 'teacher' && (
                    <Button
                      aria-label="Delete Record"
                      variant="outline"
                      size="sm"
                      onClick={() => setPendingDelete({ record })}
                    >
                      <Trash2
                        className="text-destructive h-4 w-4"
                        aria-hidden
                      />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <RecordDetailDialog
        record={selectedRecord}
        onClose={() => setSelectedRecord(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        variant="destructive"
        title={
          pendingDelete === 'all'
            ? `Delete all ${plural(records.length, 'record')}?`
            : 'Delete this record?'
        }
        description={
          pendingDelete === 'all'
            ? 'This permanently deletes every saved result. It cannot be undone.'
            : `The saved result for ${
                (pendingDelete && pendingDelete.record.studentId) ||
                'this sheet'
              } is deleted. It cannot be undone.`
        }
        confirmLabel={pendingDelete === 'all' ? 'Delete all' : 'Delete'}
        onConfirm={confirmDelete}
      />
    </div>
  )
}

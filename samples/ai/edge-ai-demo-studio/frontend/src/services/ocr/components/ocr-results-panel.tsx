// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertCircle, Ban, Loader, ScanText, Square, Timer } from 'lucide-react'
import { EmptyState } from '@/components/common/empty-state'
import { InlineNotice } from '@/components/common/inline-notice'
import type { Tone } from '@/components/common/tones'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { OcrResult } from '../hooks'
import { OcrTextReview } from './ocr-text-review'

interface OcrResultsPanelProps {
  result: OcrResult | null
  isRunning: boolean
  /** Text recognised so far while a run is in progress (VL models stream it). */
  partialText: string
  /** Cancel was pressed and the run has not stopped yet. */
  isCancelling: boolean
  /** The last run was cancelled. */
  isCancelled: boolean
  onCancel: () => void
  error: Error | null
  highlightIndex: number | null
  onRegionHover: (index: number | null) => void
  /** The image's file name, to name the downloads after. */
  sourceName?: string
}

function confidenceTone(c: number): Tone {
  if (c >= 0.9) return 'success'
  if (c >= 0.7) return 'warning'
  return 'destructive'
}

function RunProgress({
  isCancelling,
  onCancel,
}: {
  isCancelling: boolean
  onCancel: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
        <Loader aria-hidden="true" className="h-3 w-3 animate-spin" />
        {isCancelling ? 'Cancelling…' : 'Generating…'}
      </span>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5"
        onClick={onCancel}
        disabled={isCancelling}
        data-testid="ocr-cancel"
      >
        <Square aria-hidden="true" className="h-3 w-3" />
        Cancel
      </Button>
    </div>
  )
}

export function OcrResultsPanel({
  result,
  isRunning,
  partialText,
  isCancelling,
  isCancelled,
  onCancel,
  error,
  highlightIndex,
  onRegionHover,
  sourceName,
}: OcrResultsPanelProps) {
  if (error) {
    return (
      <InlineNotice
        tone="destructive"
        size="sm"
        icon={<AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />}
      >
        <span className="font-semibold">OCR failed:</span> {error.message}
      </InlineNotice>
    )
  }

  if (isRunning && partialText) {
    return (
      <div className="min-w-0 space-y-2" data-testid="ocr-results-partial">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Extracted Text</p>
          <RunProgress isCancelling={isCancelling} onCancel={onCancel} />
        </div>
        <div
          data-testid="ocr-partial-text"
          aria-live="polite"
          className="border-border bg-muted/20 max-h-[200px] overflow-auto rounded-xl border p-4 text-sm leading-relaxed break-words whitespace-pre-wrap"
        >
          {partialText}
        </div>
      </div>
    )
  }

  if (isRunning) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-[28px] w-24 rounded-md" />
          <RunProgress isCancelling={isCancelling} onCancel={onCancel} />
        </div>
        <Skeleton className="h-[120px] rounded-xl" />
        <Skeleton className="h-[200px] rounded-xl" />
      </div>
    )
  }

  if (isCancelled) {
    return (
      <div data-testid="ocr-results-cancelled" className="h-full">
        <EmptyState
          icon={Ban}
          title="Cancelled"
          description="Run OCR again to see detected text here."
          className="h-full min-h-[300px]"
        />
      </div>
    )
  }

  if (!result) {
    return (
      <EmptyState
        icon={ScanText}
        title="No results yet"
        description="Run OCR on an image to see detected text here."
        className="h-full min-h-[300px]"
      />
    )
  }

  return (
    <div className="min-w-0 space-y-4" data-testid="ocr-results">
      <div className="space-y-2">
        {result.full_text ? (
          <OcrTextReview result={result} sourceName={sourceName} />
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium">Extracted text</p>
            <p
              data-testid="ocr-no-text"
              className="border-border bg-muted/20 text-muted-foreground rounded-xl border p-4 text-sm"
            >
              No text detected. Try a sharper image, or another language or
              model.
            </p>
          </div>
        )}
        <div className="text-muted-foreground flex items-center text-xs">
          <span
            title={`Latency: ${result.elapsed_ms} ms`}
            className="bg-muted/50 inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium tabular-nums"
          >
            <Timer aria-hidden="true" className="h-3 w-3 shrink-0" />
            {result.elapsed_ms} ms
          </span>
        </div>
      </div>

      {result.regions.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Detected regions ({result.regions.length})
          </p>
          <p className="text-muted-foreground text-xs">
            Each line as the model read it, with its confidence. Hover a row to
            find it on the image.
          </p>
          <ScrollArea className="h-[280px] rounded-xl border">
            <Table className="w-full table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Text</TableHead>
                  <TableHead className="w-28 text-right">Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.regions.map((r, i) => (
                  <TableRow
                    key={i}
                    onMouseEnter={() => onRegionHover(i)}
                    onMouseLeave={() => onRegionHover(null)}
                    className={cn(
                      'cursor-default',
                      i === highlightIndex && 'bg-primary/5',
                    )}
                  >
                    <TableCell className="text-muted-foreground tabular-nums">
                      {i + 1}
                    </TableCell>
                    <TableCell className="font-medium break-words whitespace-normal">
                      {r.text}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        tone={confidenceTone(r.confidence)}
                        className="tabular-nums"
                      >
                        {(r.confidence * 100).toFixed(1)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}

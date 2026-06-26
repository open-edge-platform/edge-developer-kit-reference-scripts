// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertCircle, Check, Copy, ScanText, Timer } from 'lucide-react'
import { useState } from 'react'
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

interface OcrResultsPanelProps {
  result: OcrResult | null
  isRunning: boolean
  error: Error | null
  highlightIndex: number | null
  onRegionHover: (index: number | null) => void
}

function confidenceBadgeClass(c: number) {
  if (c >= 0.9)
    return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
  if (c >= 0.7)
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300'
  return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300'
}

export function OcrResultsPanel({
  result,
  isRunning,
  error,
  highlightIndex,
  onRegionHover,
}: OcrResultsPanelProps) {
  const [copied, setCopied] = useState(false)

  const copyText = async () => {
    if (!result?.full_text) return
    await navigator.clipboard.writeText(result.full_text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="border-destructive/50 bg-destructive/10 text-destructive flex items-start gap-3 rounded-lg border p-4">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-semibold">OCR failed</p>
          <p className="text-sm">{error.message}</p>
        </div>
      </div>
    )
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isRunning) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-[28px] w-24 rounded-md" />
        <Skeleton className="h-[120px] rounded-xl" />
        <Skeleton className="h-[200px] rounded-xl" />
      </div>
    )
  }

  // ── Empty ────────────────────────────────────────────────────────────────
  if (!result) {
    return (
      <div className="text-muted-foreground flex h-full min-h-[300px] flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
        <div className="bg-muted mb-3 flex h-14 w-14 items-center justify-center rounded-full">
          <ScanText className="h-7 w-7" />
        </div>
        <p className="text-sm font-medium">No results yet</p>
        <p className="text-xs">
          Run OCR on an image to see detected text here.
        </p>
      </div>
    )
  }

  // ── Success ──────────────────────────────────────────────────────────────
  return (
    <div className="min-w-0 space-y-4" data-testid="ocr-results">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Extracted Text</p>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={copyText}
            disabled={!result.full_text}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <div
          data-testid="ocr-extracted-text"
          className="border-border bg-muted/20 max-h-[200px] overflow-auto rounded-xl border p-4 text-sm leading-relaxed break-words whitespace-pre-wrap"
        >
          {result.full_text || (
            <span className="text-muted-foreground">No text detected.</span>
          )}
        </div>
        <div className="text-muted-foreground flex items-center text-xs">
          <span
            title={`Latency: ${result.elapsed_ms} ms`}
            className="bg-muted/50 inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium tabular-nums"
          >
            <Timer className="h-3 w-3 shrink-0" />
            {result.elapsed_ms} ms
          </span>
        </div>
      </div>

      {result.regions.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Regions ({result.regions.length})
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
                        variant="secondary"
                        className={cn(
                          'tabular-nums',
                          confidenceBadgeClass(r.confidence),
                        )}
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

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertCircle, Loader2, ScanFace } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { RecognizeResult } from '../hooks'

interface FaceResultsPanelProps {
  result: RecognizeResult | null
  isRunning: boolean
  error: Error | null
}

export function FaceResultsPanel({
  result,
  isRunning,
  error,
}: FaceResultsPanelProps) {
  if (isRunning) {
    return (
      <div className="text-muted-foreground flex min-h-[160px] items-center justify-center gap-2 rounded-xl border border-dashed text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Running recognition…
      </div>
    )
  }
  if (error) {
    return (
      <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-xl border p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error.message}
        </p>
      </div>
    )
  }
  if (!result) {
    return (
      <div className="text-muted-foreground flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-center text-sm">
        <ScanFace className="h-6 w-6" />
        Recognition results will appear here.
      </div>
    )
  }

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          {result.label}
          <Badge variant="outline" className="font-mono text-[10px]">
            {result.runtime}
          </Badge>
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          detect {result.detect_ms.toFixed(1)} ms · embed{' '}
          {result.embed_ms.toFixed(1)} ms · threshold ≥ {result.threshold} ·{' '}
          {result.gallery_size} enrolled person
          {result.gallery_size === 1 ? '' : 's'}
        </p>
      </CardHeader>
      <CardContent>
        {result.faces.length === 0 ? (
          <p className="text-muted-foreground text-sm">No faces detected.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Best match</TableHead>
                <TableHead className="text-right">Similarity</TableHead>
                <TableHead className="text-right">Verdict</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.faces.map((face, i) => (
                <TableRow key={i}>
                  <TableCell className="text-muted-foreground">
                    {i + 1}
                  </TableCell>
                  <TableCell className="min-w-0">
                    <p className="truncate font-medium">
                      {face.match?.name ?? '—'}
                    </p>
                    {face.similarities.length > 1 && (
                      <p className="text-muted-foreground truncate text-[11px]">
                        {face.similarities
                          .slice(1, 4)
                          .map((s) => `${s.name} ${s.similarity.toFixed(2)}`)
                          .join(' · ')}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {face.match ? face.match.similarity.toFixed(4) : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {face.match ? (
                      <Badge variant={face.matched ? 'default' : 'secondary'}>
                        {face.matched ? face.match.name : 'Unknown'}
                      </Badge>
                    ) : (
                      <Badge variant="outline">No gallery</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

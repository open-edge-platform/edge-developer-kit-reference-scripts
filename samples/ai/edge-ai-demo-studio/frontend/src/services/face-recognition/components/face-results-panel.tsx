// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertCircle, Loader, ScanFace } from 'lucide-react'
import { EmptyState } from '@/components/common/empty-state'
import { InlineNotice } from '@/components/common/inline-notice'
import { TruncatedText } from '@/components/common/truncated-text'
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
import { plural } from '@/lib/browser/format'
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
      <EmptyState
        icon={Loader}
        iconClassName="animate-spin"
        description="Running recognition…"
        className="min-h-[160px] py-8"
      />
    )
  }
  if (error) {
    return (
      <InlineNotice
        tone="destructive"
        size="sm"
        icon={<AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />}
      >
        {error.message}
      </InlineNotice>
    )
  }
  if (!result) {
    return (
      <EmptyState
        icon={ScanFace}
        description="Recognition results will appear here."
        className="min-h-[160px] py-8"
      />
    )
  }

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <TruncatedText text={result.label} className="max-w-full" />
          <Badge variant="outline" className="font-mono text-xs">
            {result.runtime}
          </Badge>
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          detect {result.detect_ms.toFixed(1)} ms · embed{' '}
          {result.embed_ms.toFixed(1)} ms · threshold ≥ {result.threshold} ·{' '}
          {plural(result.gallery_size, 'enrolled person')}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {result.gallery_size === 0 && result.faces.length > 0 && (
          <p
            className="text-muted-foreground text-xs"
            data-testid="face-results-no-gallery"
          >
            {result.faces.length === 1
              ? 'The face was detected but not identified: '
              : `All ${result.faces.length} faces were detected but not identified: `}
            nobody was enrolled in the gallery when this photo was checked.
          </p>
        )}
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
                  <TableCell className="w-full max-w-0">
                    <TruncatedText
                      text={face.match?.name ?? '—'}
                      className="font-medium"
                    />
                    {face.similarities.length > 1 && (
                      <TruncatedText
                        text={face.similarities
                          .slice(1, 4)
                          .map((s) => `${s.name} ${s.similarity.toFixed(2)}`)
                          .join(' · ')}
                        className="text-muted-foreground text-xs"
                      />
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
                      <Badge variant="outline" title="Nobody is enrolled">
                        Unknown
                      </Badge>
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

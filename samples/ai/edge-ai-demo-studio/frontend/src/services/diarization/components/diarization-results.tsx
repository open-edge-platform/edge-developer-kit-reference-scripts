// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Ban, Check, ChevronDown, Copy, Download, Users } from 'lucide-react'
import { EmptyState } from '@/components/common/empty-state'
import { InlineNotice } from '@/components/common/inline-notice'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { downloadBlob } from '@/lib/browser/download'
import { plural } from '@/lib/browser/format'
import { cn } from '@/lib/utils'
import { JobProgress } from '@/services/common/jobs/job-progress'
import type { DiarizeJobStatus, DiarizeSegment, DiarizeStage } from '../hooks'
import {
  type SegmentsFormat,
  segmentsFile,
  segmentsText,
} from '../lib/segments-export'
import {
  formatSegmentTime,
  getSpeakerColorIndex,
  SPEAKER_COLORS,
} from '../lib/speakers'

const STAGE_LABELS: Record<Exclude<DiarizeStage, 'queued'>, string> = {
  decoding: 'Decoding audio',
  segmentation: 'Detecting speech',
  embeddings: 'Extracting voice prints',
  clustering: 'Grouping speakers',
  matching: 'Matching enrolled speakers',
}

function stageLabel(status: DiarizeJobStatus | null): string {
  return status?.stage && status.stage !== 'queued'
    ? STAGE_LABELS[status.stage]
    : 'Diarizing audio'
}

function TimelineBar({
  segments,
  totalDuration,
  speakerMap,
}: {
  segments: DiarizeSegment[]
  totalDuration: number
  speakerMap: Map<string, number>
}) {
  return (
    <div>
      <div className="bg-muted/30 relative h-8 w-full overflow-hidden rounded-lg">
        {segments.map((seg, i) => {
          const colorIdx = getSpeakerColorIndex(seg.speaker, speakerMap)
          return (
            <div
              key={`${seg.speaker}-${seg.start}-${i}`}
              title={`${seg.speaker}: ${formatSegmentTime(seg.start)} – ${formatSegmentTime(seg.end)}`}
              className={cn(
                'absolute top-0 h-full opacity-80',
                SPEAKER_COLORS[colorIdx],
              )}
              style={{
                left: `${(seg.start / totalDuration) * 100}%`,
                width: `${Math.max(((seg.end - seg.start) / totalDuration) * 100, 0.5)}%`,
              }}
            />
          )
        })}
      </div>
      <div className="text-muted-foreground mt-1 flex justify-between text-xs tabular-nums">
        <span>0:00.0</span>
        <span>{formatSegmentTime(totalDuration)}</span>
      </div>
    </div>
  )
}

function SpeakerLegend({
  speakers,
  speakerMap,
}: {
  speakers: string[]
  speakerMap: Map<string, number>
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
      {speakers.map((sp) => {
        const colorIdx = getSpeakerColorIndex(sp, speakerMap)
        return (
          <div
            key={sp}
            className="text-foreground flex items-center gap-1.5 text-xs"
          >
            <div
              aria-hidden="true"
              className={cn(
                'h-2.5 w-2.5 rounded-full',
                SPEAKER_COLORS[colorIdx],
              )}
            />
            {sp}
          </div>
        )
      })}
    </div>
  )
}

function SegmentList({
  segments,
  speakerMap,
}: {
  segments: DiarizeSegment[]
  speakerMap: Map<string, number>
}) {
  return (
    <ScrollArea className="mt-4 min-h-0 flex-1">
      <div className="space-y-1">
        {segments.map((seg, i) => {
          const colorIdx = getSpeakerColorIndex(seg.speaker, speakerMap)
          return (
            <div
              key={`seg-${seg.start}-${i}`}
              className="hover:bg-muted/20 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors"
            >
              <span className="text-muted-foreground w-28 shrink-0 font-mono text-xs tabular-nums">
                {formatSegmentTime(seg.start)} – {formatSegmentTime(seg.end)}
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <div
                  aria-hidden="true"
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    SPEAKER_COLORS[colorIdx],
                  )}
                />
                <span className="text-foreground truncate text-sm">
                  {seg.speaker}
                </span>
              </div>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {(seg.end - seg.start).toFixed(1)}s
              </span>
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

/** Copy the speaker turns as text, or save them as CSV, JSON or text named after the recording. */
function SegmentsExport({
  segments,
  recordingName,
}: {
  segments: DiarizeSegment[]
  recordingName: string | undefined
}) {
  const { copied, copy } = useCopyToClipboard()
  const save = (format: SegmentsFormat) => {
    const { blob, fileName } = segmentsFile(format, segments, recordingName)
    downloadBlob(blob, fileName)
  }
  return (
    <div className="flex flex-wrap gap-2" data-testid="diarization-export">
      <Button
        variant="outline"
        size="sm"
        onClick={() => void copy(segmentsText(segments))}
        data-testid="diarization-copy"
      >
        {copied ? (
          <Check aria-hidden="true" className="h-3.5 w-3.5" />
        ) : (
          <Copy aria-hidden="true" className="h-3.5 w-3.5" />
        )}
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            data-testid="diarization-download"
          >
            <Download aria-hidden="true" className="h-3.5 w-3.5" />
            Download
            <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => save('csv')}>
            Spreadsheet (.csv)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => save('json')}>
            JSON (.json)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => save('txt')}>
            Text (.txt)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** Where the diarization is: running, how it ended, or its segments. */
export type DiarizationView =
  | { state: 'idle' }
  | {
      state: 'running'
      queued: boolean
      status: DiarizeJobStatus | null
      cancelling: boolean
      onCancel: () => void
    }
  | { state: 'cancelled' }
  | { state: 'failed'; message: string }
  | { state: 'done'; segments: DiarizeSegment[] }

export function DiarizationResults({
  view,
  speakerMap,
  recordingName,
}: {
  view: DiarizationView
  /** Colour index of each speaker, enrolled ones first. */
  speakerMap: Map<string, number>
  /** The recording's file name, to name the downloads after. */
  recordingName?: string
}) {
  const segments = view.state === 'done' ? view.segments : []
  const uniqueSpeakers = [...new Set(segments.map((s) => s.speaker))]
  const totalDuration =
    segments.length > 0 ? Math.max(...segments.map((s) => s.end)) : 0

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-foreground text-sm font-medium">Speakers</h3>
          {segments.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {plural(uniqueSpeakers.length, 'speaker')} ·{' '}
              {plural(segments.length, 'turn')}
            </Badge>
          )}
        </div>
        {segments.length > 0 && (
          <SegmentsExport segments={segments} recordingName={recordingName} />
        )}
      </div>

      <div className="border-border h-[480px] overflow-hidden rounded-xl border">
        {view.state === 'idle' && (
          <EmptyState
            icon={Users}
            size="sm"
            title="No speakers identified yet"
            description="Upload a recording with several people talking, then identify speakers to see who spoke when."
            className="h-full py-16"
          />
        )}

        {view.state === 'running' && (
          <div className="flex h-full items-center justify-center px-6">
            <JobProgress
              label={stageLabel(view.status)}
              queued={view.queued}
              position={view.status?.position}
              percent={
                view.status?.status === 'running'
                  ? (view.status.progress ?? 0) * 100
                  : undefined
              }
              cancelling={view.cancelling}
              onCancel={view.onCancel}
            />
          </div>
        )}

        {view.state === 'cancelled' && (
          <EmptyState
            icon={Ban}
            size="sm"
            description="Diarization cancelled."
            className="h-full"
          />
        )}

        {view.state === 'failed' && (
          <div className="flex h-full items-center justify-center p-4">
            <InlineNotice tone="destructive" size="sm">
              Error: {view.message}
            </InlineNotice>
          </div>
        )}

        {view.state === 'done' && segments.length === 0 && (
          <EmptyState
            icon={Users}
            size="sm"
            description="No speaker segments detected."
            className="h-full"
          />
        )}

        {segments.length > 0 && (
          <div className="flex h-full flex-col p-4">
            {totalDuration > 0 && (
              <TimelineBar
                segments={segments}
                totalDuration={totalDuration}
                speakerMap={speakerMap}
              />
            )}
            <SpeakerLegend speakers={uniqueSpeakers} speakerMap={speakerMap} />
            <SegmentList segments={segments} speakerMap={speakerMap} />
          </div>
        )}
      </div>
    </div>
  )
}

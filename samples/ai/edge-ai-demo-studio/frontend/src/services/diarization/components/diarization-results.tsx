// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader2, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { formatTime, getSpeakerColorIndex, SPEAKER_COLORS } from './shared'

interface Segment {
  speaker: string
  start: number
  end: number
}

function TimelineBar({
  segments,
  totalDuration,
  speakerMap,
}: {
  segments: Segment[]
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
              title={`${seg.speaker}: ${formatTime(seg.start)} – ${formatTime(seg.end)}`}
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
      <div className="text-muted-foreground mt-1 flex justify-between text-[10px] tabular-nums">
        <span>0:00.0</span>
        <span>{formatTime(totalDuration)}</span>
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
  segments: Segment[]
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
                {formatTime(seg.start)} – {formatTime(seg.end)}
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <div
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

export function DiarizationResults({
  segments,
  speakerMap,
  uniqueSpeakers,
  totalDuration,
  isPending,
  isError,
  errorMessage,
}: {
  segments: Segment[] | undefined
  speakerMap: Map<string, number>
  uniqueSpeakers: string[]
  totalDuration: number
  isPending: boolean
  isError: boolean
  errorMessage?: string
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-foreground text-sm font-medium">
          Diarization Results
        </p>
        {segments && segments.length > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {uniqueSpeakers.length} speaker
            {uniqueSpeakers.length !== 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      <div
        className={cn(
          'border-border h-[480px] overflow-hidden rounded-xl border',
          !segments && !isPending && !isError ? 'border-dashed' : '',
        )}
      >
        {/* Idle state */}
        {!isPending && !isError && !segments && (
          <div className="bg-muted/5 flex h-full flex-col items-center justify-center gap-2 py-16">
            <Users className="text-muted-foreground h-6 w-6" />
            <p className="text-muted-foreground text-sm font-medium">
              No diarization results
            </p>
            <p className="text-muted-foreground/70 text-xs">
              Upload multi-speaker audio to see speaker segments.
            </p>
          </div>
        )}

        {/* Loading state */}
        {isPending && (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
            <p className="text-muted-foreground text-sm">Diarizing audio…</p>
          </div>
        )}

        {/* Error state */}
        {isError && !isPending && (
          <div className="flex h-full items-center justify-center p-4">
            <p className="text-destructive text-sm">Error: {errorMessage}</p>
          </div>
        )}

        {/* Empty results */}
        {!isPending && segments && segments.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground text-sm">
              No speaker segments detected.
            </p>
          </div>
        )}

        {/* Success state */}
        {!isPending && segments && segments.length > 0 && (
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

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { DiarizeSegment } from '../hooks'
import { formatSegmentTime } from './speakers'

export type SegmentsFormat = 'csv' | 'json' | 'txt'

/** One CSV field, quoted when it holds a separator, quote or line break. */
function csvField(value: string | number): string {
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** The turns as readable lines: `0:01.5 – 0:04.0  Alice`. */
export function segmentsText(segments: DiarizeSegment[]): string {
  return segments
    .map(
      (seg) =>
        `${formatSegmentTime(seg.start)} – ${formatSegmentTime(seg.end)}  ${seg.speaker}`,
    )
    .join('\n')
}

/** The turns as CSV, times in seconds. */
function segmentsCsv(segments: DiarizeSegment[]): string {
  const rows = segments.map((seg) =>
    [
      seg.speaker,
      seg.start.toFixed(3),
      seg.end.toFixed(3),
      (seg.end - seg.start).toFixed(3),
    ]
      .map(csvField)
      .join(','),
  )
  return ['speaker,start_s,end_s,duration_s', ...rows].join('\n') + '\n'
}

const MIME: Record<SegmentsFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  json: 'application/json',
  txt: 'text/plain;charset=utf-8',
}

/**
 * The speaker turns as a file of `format`, named after the recording
 * (`meeting.wav` → `meeting-speakers.csv`).
 */
export function segmentsFile(
  format: SegmentsFormat,
  segments: DiarizeSegment[],
  recordingName: string | undefined,
): { blob: Blob; fileName: string } {
  const content =
    format === 'csv'
      ? segmentsCsv(segments)
      : format === 'json'
        ? JSON.stringify(
            { recording: recordingName ?? null, segments },
            null,
            2,
          ) + '\n'
        : segmentsText(segments) + '\n'
  const base = (recordingName ?? '').replace(/\.[^./\\]+$/, '') || 'diarization'
  return {
    blob: new Blob([content], { type: MIME[format] }),
    fileName: `${base}-speakers.${format}`,
  }
}

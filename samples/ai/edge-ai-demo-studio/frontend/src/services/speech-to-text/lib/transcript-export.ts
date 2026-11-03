// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** A stretch of the transcript with its time in the audio, in seconds. */
export interface TimedText {
  start: number
  end: number
  text: string
}

export type TranscriptFormat = 'txt' | 'srt' | 'vtt'

/** `hh:mm:ss<sep>mmm`, the timestamp both subtitle formats use. */
function cueTime(seconds: number, separator: ',' | '.'): string {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(ms % 1000, 3)}`
}

/** Segments with text and a time span. */
export function subtitleCues(segments: TimedText[] | undefined): TimedText[] {
  return (segments ?? []).filter(
    (s) => s.text.trim() && Number.isFinite(s.end) && s.end > s.start,
  )
}

/** SubRip subtitles: numbered cues, comma before the milliseconds. */
function toSrt(cues: TimedText[]): string {
  return (
    cues
      .map(
        (cue, i) =>
          `${i + 1}\n${cueTime(cue.start, ',')} --> ${cueTime(cue.end, ',')}\n${cue.text.trim()}`,
      )
      .join('\n\n') + '\n'
  )
}

/** WebVTT subtitles: a header, then cues with a dot before the milliseconds. */
function toVtt(cues: TimedText[]): string {
  const body = cues
    .map(
      (cue) =>
        `${cueTime(cue.start, '.')} --> ${cueTime(cue.end, '.')}\n${cue.text.trim()}`,
    )
    .join('\n\n')
  return `WEBVTT\n\n${body}\n`
}

const MIME: Record<TranscriptFormat, string> = {
  txt: 'text/plain;charset=utf-8',
  srt: 'application/x-subrip;charset=utf-8',
  vtt: 'text/vtt;charset=utf-8',
}

/** Named after the source: `meeting.wav` → `meeting.srt`. */
export function transcriptFile(
  format: TranscriptFormat,
  text: string,
  cues: TimedText[],
  sourceName: string,
): { blob: Blob; fileName: string } {
  const content =
    format === 'srt'
      ? toSrt(cues)
      : format === 'vtt'
        ? toVtt(cues)
        : `${text}\n`
  const base = sourceName.replace(/\.[^./\\]+$/, '') || 'transcript'
  return {
    blob: new Blob([content], { type: MIME[format] }),
    fileName: `${base}.${format}`,
  }
}

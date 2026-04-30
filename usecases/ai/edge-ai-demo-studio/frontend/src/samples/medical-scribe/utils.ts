// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { TranscriptEntry } from './types'

/**
 * Aligns full transcription text with diarization segments by distributing
 * words proportionally based on segment duration.
 */
export function alignTranscriptWithSegments(
  fullText: string,
  segments: { speaker: string; start: number; end: number }[],
): TranscriptEntry[] {
  if (segments.length === 0 || !fullText.trim()) return []

  const words = fullText.trim().split(/\s+/)
  const totalDuration = segments.reduce((sum, s) => sum + (s.end - s.start), 0)

  let wordIndex = 0
  return segments.map((seg, i) => {
    const segDuration = seg.end - seg.start
    const fraction =
      totalDuration > 0 ? segDuration / totalDuration : 1 / segments.length
    const remaining = words.length - wordIndex
    const wordCount =
      i === segments.length - 1
        ? remaining
        : Math.min(Math.max(0, Math.round(fraction * words.length)), remaining)
    const segWords = words.slice(wordIndex, wordIndex + wordCount)
    wordIndex += wordCount
    return {
      speaker: seg.speaker,
      text: segWords.join(' '),
      start: seg.start,
      end: seg.end,
    }
  })
}

export async function parseResponse<T>(
  res: Response,
  fallback: string,
): Promise<T> {
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || fallback)
  }
  return res.json() as Promise<T>
}

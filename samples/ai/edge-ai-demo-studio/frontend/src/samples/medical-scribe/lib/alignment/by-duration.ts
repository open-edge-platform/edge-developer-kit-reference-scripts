// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { DiarizationSeg, TranscriptEntry } from '../types'
import { joinTokens, tokenize } from './text'

/**
 * Last-resort fallback: used when neither word-level nor segment-level
 * timestamps are available. Allocates each diarization segment a share of
 * the words proportional to its duration, with no per-word alignment.
 */
export function alignByDuration(
  fullText: string,
  diarizationSegments: DiarizationSeg[],
): TranscriptEntry[] {
  const words = tokenize(fullText)
  const totalDuration = diarizationSegments.reduce(
    (sum, s) => sum + (s.end - s.start),
    0,
  )

  let wordIndex = 0
  return diarizationSegments.map((seg, i) => {
    const segDuration = seg.end - seg.start
    const fraction =
      totalDuration > 0
        ? segDuration / totalDuration
        : 1 / diarizationSegments.length
    const remaining = words.length - wordIndex
    const wordCount =
      i === diarizationSegments.length - 1
        ? remaining
        : Math.min(Math.max(0, Math.round(fraction * words.length)), remaining)
    const segWords = words.slice(wordIndex, wordIndex + wordCount)
    wordIndex += wordCount
    return {
      speaker: seg.speaker,
      text: joinTokens(segWords),
      start: seg.start,
      end: seg.end,
    }
  })
}

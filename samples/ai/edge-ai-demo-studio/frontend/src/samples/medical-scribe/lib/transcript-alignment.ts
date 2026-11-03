// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { DiarizationSeg, TranscriptEntry, WhisperSeg } from './types'

// Alignment tunables.

/** Matches a token whose visible end is sentence-terminal punctuation. */
const SENTENCE_TERMINATOR = /[.!?]+["')\]]*$/
/** Drop sub-200 ms (or sub-10 % of chunk duration) overlaps as boundary jitter. */
const MIN_OVERLAP_S = 0.2
const MIN_OVERLAP_FRACTION = 0.1
/** Sentence-snap: tolerance = max(MIN_SNAP_TOLERANCE, SNAP_FRACTION * wordCount). */
const MIN_SNAP_TOLERANCE = 3
const SNAP_FRACTION = 0.2
/** Fragment healer: only migrate up to this many words from entry B. */
const HEAL_MAX_WORDS = 5
/** Fragment healer: entry A must be longer than this to absorb B's tail. */
const HEAL_MIN_A_WORDS = 3

/**
 * Aligns timestamped Whisper chunks with diarization segments. A chunk straddling segments is split
 * by per-speaker overlap so short interjections are not swallowed by the dominant speaker. Without
 * chunk timestamps, falls back to a duration-proportional split.
 */
export function alignTranscriptWithSegments(
  fullText: string,
  diarizationSegments: DiarizationSeg[],
  whisperSegments?: WhisperSeg[],
): TranscriptEntry[] {
  if (diarizationSegments.length === 0 || !fullText.trim()) return []

  // Path A: timestamp overlap alignment, splitting chunks that straddle speakers.
  if (whisperSegments && whisperSegments.length > 0) {
    type Piece = { speaker: string; start: number; end: number; text: string }
    const pieces: Piece[] = []

    for (const chunk of whisperSegments) {
      const text = chunk.text.trim()
      if (!text) continue
      const chunkDuration = Math.max(0, chunk.end - chunk.start)
      const minSignificant = Math.max(
        MIN_OVERLAP_S,
        chunkDuration * MIN_OVERLAP_FRACTION,
      )

      const allOverlaps: { seg: DiarizationSeg; overlap: number }[] = []
      const sigOverlaps: { seg: DiarizationSeg; overlap: number }[] = []
      for (const seg of diarizationSegments) {
        const overlap =
          Math.min(chunk.end, seg.end) - Math.max(chunk.start, seg.start)
        if (overlap <= 0) continue
        const entry = { seg, overlap }
        allOverlaps.push(entry)
        if (overlap >= minSignificant) sigOverlaps.push(entry)
      }
      const candidates = sigOverlaps.length > 0 ? sigOverlaps : allOverlaps

      if (candidates.length === 0) {
        // Outside every segment: assign to the nearest one by midpoint.
        const chunkMid = (chunk.start + chunk.end) / 2
        let best = diarizationSegments[0]
        let bestDist = Infinity
        for (const seg of diarizationSegments) {
          const dist = Math.abs(chunkMid - (seg.start + seg.end) / 2)
          if (dist < bestDist) {
            bestDist = dist
            best = seg
          }
        }
        pieces.push({
          speaker: best.speaker,
          start: chunk.start,
          end: chunk.end,
          text,
        })
        continue
      }

      if (candidates.length === 1) {
        // Clean single-speaker chunk — keep text intact.
        pieces.push({
          speaker: candidates[0].seg.speaker,
          start: chunk.start,
          end: chunk.end,
          text,
        })
        continue
      }

      // Straddling chunk: split words by each speaker's overlap share, snapping each split to
      // the nearest sentence boundary within tolerance.
      const ordered = [...candidates].sort((a, b) => a.seg.start - b.seg.start)
      let totalOverlap = 0
      for (const o of ordered) totalOverlap += o.overlap
      const words = text.split(/\s+/)

      // Inner sentence boundaries: word index i+1 where words[i] ends a sentence.
      const innerBoundaries: number[] = []
      for (let i = 0; i < words.length - 1; i++) {
        if (SENTENCE_TERMINATOR.test(words[i])) innerBoundaries.push(i + 1)
      }
      const tolerance = Math.max(
        MIN_SNAP_TOLERANCE,
        Math.round(words.length * SNAP_FRACTION),
      )

      let cumulative = 0
      let from = 0
      for (let i = 0; i < ordered.length; i++) {
        const { seg, overlap } = ordered[i]
        let to: number
        if (i === ordered.length - 1) {
          to = words.length
        } else {
          cumulative += overlap
          const target = Math.round((cumulative / totalOverlap) * words.length)
          let snapped = target
          let bestDist = tolerance + 1
          for (const b of innerBoundaries) {
            const dist = Math.abs(b - target)
            if (dist <= tolerance && dist < bestDist) {
              bestDist = dist
              snapped = b
            }
          }
          // Keep positions strictly monotonic.
          to = Math.max(from + 1, Math.min(words.length - 1, snapped))
        }
        if (to <= from) continue
        pieces.push({
          speaker: seg.speaker,
          start: Math.max(chunk.start, seg.start),
          end: Math.min(chunk.end, seg.end),
          text: words.slice(from, to).join(' '),
        })
        from = to
      }
    }

    // Merge consecutive same-speaker pieces into TranscriptEntry blocks.
    const merged: TranscriptEntry[] = []
    for (const item of pieces) {
      const last = merged[merged.length - 1]
      if (last && last.speaker === item.speaker) {
        last.text = `${last.text} ${item.text}`.trim()
        last.end = item.end
      } else {
        merged.push({
          speaker: item.speaker,
          text: item.text,
          start: item.start,
          end: item.end,
        })
      }
    }

    // Heal fragments across speaker boundaries: when A ends mid-sentence and B starts with a
    // short fragment ending in .!?, move it back to A (Whisper can put a sentence's last words
    // in the next chunk, e.g. "...but it's" + "worrying. I understand").
    for (let i = 0; i < merged.length - 1; i++) {
      const a = merged[i]
      const b = merged[i + 1]
      if (SENTENCE_TERMINATOR.test(a.text)) continue
      const aWords = a.text.split(/\s+/)
      if (aWords.length <= HEAL_MIN_A_WORDS) continue
      const bWords = b.text.split(/\s+/)
      if (bWords.length < 2) continue
      const scanLimit = Math.min(HEAL_MAX_WORDS, bWords.length - 1)
      let cut = -1
      for (let j = 0; j < scanLimit; j++) {
        if (SENTENCE_TERMINATOR.test(bWords[j])) {
          cut = j + 1
          break
        }
      }
      if (cut < 0) continue
      a.text = `${a.text} ${bWords.slice(0, cut).join(' ')}`.trim()
      b.text = bWords.slice(cut).join(' ')
    }
    return merged
  }

  // Path B: no chunk timestamps, so split words by segment duration.
  const words = fullText.trim().split(/\s+/)
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
      text: segWords.join(' '),
      start: seg.start,
      end: seg.end,
    }
  })
}

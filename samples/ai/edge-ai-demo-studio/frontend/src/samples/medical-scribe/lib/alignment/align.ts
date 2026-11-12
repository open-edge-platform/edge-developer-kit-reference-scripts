// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { TimedText } from '@/services/speech-to-text/lib/transcript-export'
import type { DiarizationSeg, TranscriptEntry } from '../types'
import { alignByDuration } from './by-duration'
import { MIN_WORD_WEIGHT, SENTENCE_TERMINATOR, TIE_BREAK_BONUS } from './config'
import { segmentsToTokens, wordsToTokens, type TimedToken } from './tokens'
import { joinTokens } from './text'

function overlapOf(tok: TimedToken, seg: DiarizationSeg): number {
  return Math.min(tok.end, seg.end) - Math.max(tok.start, seg.start)
}

function distanceOf(tok: TimedToken, seg: DiarizationSeg): number {
  const mid = (tok.start + tok.end) / 2
  return mid < seg.start ? seg.start - mid : mid > seg.end ? mid - seg.end : 0
}

/**
 * Assigns a diarization speaker to a timed token: the segment with the
 * greatest overlap wins. If the token falls entirely inside a gap between
 * segments (no overlap at all), it's assigned to the closest segment by
 * distance from the token's midpoint instead of defaulting to the first
 * segment.
 *
 * `cursorIdx` is the first segment that could still be relevant to this (or
 * any later, since both lists are chronologically sorted) token — segments
 * entirely before it have already been permanently skipped by the caller.
 * `latestEnded` is the skipped segment with the latest end time; with
 * overlapping tracks that isn't necessarily the one right before the cursor.
 */
function assignSpeakerNear(
  tok: TimedToken,
  diarizationSegments: DiarizationSeg[],
  cursorIdx: number,
  latestEnded: DiarizationSeg | undefined,
): string {
  let bestSeg = diarizationSegments[cursorIdx]
  let bestOverlap = -Infinity
  let j = cursorIdx
  while (
    j < diarizationSegments.length &&
    diarizationSegments[j].start < tok.end
  ) {
    const overlap = overlapOf(tok, diarizationSegments[j])
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      bestSeg = diarizationSegments[j]
    }
    j++
  }
  if (bestOverlap > 0) return bestSeg.speaker

  // Gap: the closest candidates are the next segment and the skipped one that
  // ended latest.
  if (latestEnded && distanceOf(tok, latestEnded) < distanceOf(tok, bestSeg)) {
    return latestEnded.speaker
  }
  return bestSeg.speaker
}

/**
 * Tags each token with a diarization speaker, groups tokens into sentences,
 * and picks each sentence's speaker by a duration-weighted majority vote of
 * its tokens. This keeps sentences intact while still recovering short
 * interjections — a sentence only changes speaker if most of its tokens
 * actually belong to someone else.
 *
 * Both `tokens` and `diarizationSegments` must be chronologically sorted;
 * the speaker lookup advances a cursor rather than rescanning every segment
 * for every token (O(tokens + segments) instead of O(tokens * segments)).
 */
function alignTimedTokens(
  tokens: TimedToken[],
  diarizationSegments: DiarizationSeg[],
): TranscriptEntry[] {
  if (tokens.length === 0 || diarizationSegments.length === 0) return []

  let segIdx = 0
  let latestEnded: DiarizationSeg | undefined
  const tagged = tokens.map((tok) => {
    while (
      segIdx < diarizationSegments.length - 1 &&
      diarizationSegments[segIdx].end <= tok.start
    ) {
      const skipped = diarizationSegments[segIdx]
      if (!latestEnded || skipped.end > latestEnded.end) latestEnded = skipped
      segIdx++
    }
    return {
      ...tok,
      speaker: assignSpeakerNear(tok, diarizationSegments, segIdx, latestEnded),
    }
  })

  // Group tokens into sentences, splitting right after sentence-terminal
  // punctuation or a segment boundary (segments without terminal punctuation,
  // e.g. unpunctuated Chinese Whisper output, would otherwise merge separate
  // speaker turns into one majority vote). Any trailing tokens form a final
  // (possibly incomplete) sentence.
  const sentences: (typeof tagged)[] = []
  let current: typeof tagged = []
  for (const tok of tagged) {
    current.push(tok)
    if (SENTENCE_TERMINATOR.test(tok.text) || tok.boundary) {
      sentences.push(current)
      current = []
    }
  }
  if (current.length > 0) sentences.push(current)

  const merged: TranscriptEntry[] = []
  let prevSpeaker: string | undefined
  for (const sentence of sentences) {
    const weights = new Map<string, number>()
    for (const tok of sentence) {
      const weight = Math.max(tok.end - tok.start, MIN_WORD_WEIGHT)
      weights.set(tok.speaker, (weights.get(tok.speaker) ?? 0) + weight)
    }
    // Majority vote, with a small nudge toward the previous sentence's
    // speaker so a genuine tie doesn't flip-flop the conversation.
    let speaker = sentence[0].speaker
    let bestWeight = -Infinity
    for (const [candidate, weight] of weights) {
      const adjusted =
        candidate === prevSpeaker ? weight + TIE_BREAK_BONUS : weight
      if (adjusted > bestWeight) {
        bestWeight = adjusted
        speaker = candidate
      }
    }

    const start = sentence[0].start
    const end = sentence[sentence.length - 1].end
    const text = joinTokens(sentence.map((t) => t.text))

    const last = merged[merged.length - 1]
    if (last && last.speaker === speaker) {
      last.text = joinTokens([last.text, text]).trim()
      last.end = end
    } else {
      merged.push({ speaker, text, start, end })
    }
    prevSpeaker = speaker
  }

  return merged
}

/**
 * Aligns a transcript with diarization segments, picking the best available
 * strategy:
 *
 *  1. Word-level timestamps (Whisper or Qwen3-ASR + forced aligner) — each
 *     word is assigned to the diarization segment it overlaps most, or the
 *     closest one if it falls in a gap, then sentences are formed from a
 *     duration-weighted majority vote of their words' speakers.
 *  2. Segment/chunk-level timestamps — each chunk's words are given
 *     proportional timestamps and run through the same per-word alignment,
 *     with each chunk's end also forced as a sentence boundary since chunks
 *     (e.g. unpunctuated Chinese Whisper output) may lack terminal punctuation.
 *  3. Duration-proportional heuristic — used when no timestamps are available.
 */
export function alignTranscriptWithSegments(
  fullText: string,
  diarizationSegments: DiarizationSeg[],
  source?: { words?: TimedText[]; segments?: TimedText[] },
): TranscriptEntry[] {
  if (diarizationSegments.length === 0 || !fullText.trim()) return []

  const words = source?.words
  if (words && words.length > 0) {
    const tokens = wordsToTokens(fullText, words)
    if (tokens) {
      const result = alignTimedTokens(tokens, diarizationSegments)
      if (result.length > 0) return result
    }
  }

  const segments = source?.segments
  if (segments && segments.length > 0) {
    const tokens = segmentsToTokens(segments)
    const result = alignTimedTokens(tokens, diarizationSegments)
    if (result.length > 0) return result
  }

  return alignByDuration(fullText, diarizationSegments)
}

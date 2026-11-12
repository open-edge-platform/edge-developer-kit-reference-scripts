// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { TimedText } from '@/services/speech-to-text/lib/transcript-export'
import { MAX_DESYNC_FRACTION, MAX_PIECES_PER_TOKEN } from './config'
import { normalizeWord, tokenize } from './text'

export type TimedToken = {
  text: string
  start: number
  end: number
  /** Last token of a transcription segment - always a sentence boundary, even without terminal punctuation. */
  boundary?: boolean
}

/**
 * Reconciles the punctuated, whitespace-split tokens of `fullText` with a
 * flat list of timestamped word entries. Word entries may be punctuation-
 * stripped (Qwen3-ASR's forced aligner) or split into sub-word pieces
 * (Whisper splits "co-worker" into "co" + "-worker", "38.5" into "38" + ".5").
 * Consecutive word entries are accumulated until their normalized text
 * matches a token's normalized text, recovering the original punctuation.
 *
 * Returns `null` if too many tokens can't be reconciled (desync beyond
 * `MAX_DESYNC_FRACTION`), signalling the caller to fall back to a coarser
 * alignment tier.
 */
export function wordsToTokens(
  fullText: string,
  words: TimedText[],
): TimedToken[] | null {
  const tokens = tokenize(fullText)
  if (tokens.length === 0 || words.length === 0) return null

  const result: TimedToken[] = []
  let w = 0
  let desyncs = 0
  let lastEnd = words[0].start

  for (const token of tokens) {
    const targetNorm = normalizeWord(token)
    if (!targetNorm) {
      // Punctuation-only token (e.g. a stray em dash): zero-length span.
      result.push({ text: token, start: lastEnd, end: lastEnd })
      continue
    }
    if (w >= words.length) {
      result.push({ text: token, start: lastEnd, end: lastEnd })
      desyncs++
      continue
    }

    let acc = ''
    const start = words[w].start
    let end = start
    let consumed = 0
    while (
      w + consumed < words.length &&
      acc.length < targetNorm.length &&
      consumed < MAX_PIECES_PER_TOKEN
    ) {
      const piece = words[w + consumed]
      acc += normalizeWord(piece.text)
      end = piece.end
      consumed++
    }

    if (consumed > 0 && acc === targetNorm) {
      w += consumed
      result.push({ text: token, start, end })
      lastEnd = end
      continue
    }

    // Desync: the accumulated piece(s) don't match this token. Consume a
    // single word entry, anchor the token to its span, and keep going so
    // the walk has a chance to resynchronize on a later token.
    const piece = words[w]
    result.push({ text: token, start: piece.start, end: piece.end })
    w += 1
    desyncs++
    lastEnd = piece.end
  }

  if (desyncs / tokens.length > MAX_DESYNC_FRACTION) return null
  return result
}

/**
 * Converts chunk-level transcription segments into per-word tokens by
 * splitting each chunk's text on whitespace and allocating each word a time
 * span proportional to its character length within the chunk's
 * `[start, end]` window. Unlike `wordsToTokens`, no reconciliation against a
 * separate word list is needed: chunk text already carries its punctuation.
 */
export function segmentsToTokens(segments: TimedText[]): TimedToken[] {
  const tokens: TimedToken[] = []
  for (const chunk of segments) {
    const text = chunk.text.trim()
    if (!text) continue
    const words = tokenize(text)
    const chunkDuration = Math.max(0, chunk.end - chunk.start)
    const totalChars =
      words.reduce((sum, word) => sum + word.length, 0) || words.length

    let elapsedChars = 0
    for (const [i, word] of words.entries()) {
      const wordChars = word.length || 1
      const startFrac = elapsedChars / totalChars
      elapsedChars += wordChars
      const endFrac = elapsedChars / totalChars
      tokens.push({
        text: word,
        start: chunk.start + startFrac * chunkDuration,
        end: chunk.start + endFrac * chunkDuration,
        boundary: i === words.length - 1,
      })
    }
  }
  return tokens
}

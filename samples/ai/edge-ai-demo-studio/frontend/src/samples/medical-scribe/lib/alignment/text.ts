// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// ---------------------------------------------------------------------------
// CJK-aware tokenization helpers.
//
// Chinese/Japanese text has no whitespace between words, so the plain
// `split(/\s+/)` used for space-delimited languages collapses an entire CJK
// utterance into a single token. These helpers split CJK runs into
// individual characters (which is also how the STT worker's word-level
// timestamps are granular for CJK) while leaving space-delimited text
// byte-for-byte unaffected.
// ---------------------------------------------------------------------------

/** Han (incl. extension A and compatibility ideographs), Hiragana, Katakana. */
const CJK_CHAR =
  /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff]/
/** CJK symbols/punctuation and fullwidth forms (e.g. 。！？「」（）). */
const CJK_PUNCT = /[\u3000-\u303f\uff01-\uff65]/
const CJK_ANY = new RegExp(`${CJK_CHAR.source}|${CJK_PUNCT.source}`)

/**
 * Splits text into tokens. Whitespace-delimited chunks that contain no CJK
 * characters are emitted unchanged (identical to the previous
 * `split(/\s+/)` behaviour). Chunks containing CJK are further split so each
 * CJK character/punctuation mark becomes its own token, while maximal runs
 * of non-CJK characters within the same chunk (e.g. "38.5", "COVID") stay
 * intact as a single token.
 */
export function tokenize(text: string): string[] {
  const chunks = text.trim().split(/\s+/)
  const tokens: string[] = []
  for (const chunk of chunks) {
    if (!chunk) continue
    if (!CJK_ANY.test(chunk)) {
      tokens.push(chunk)
      continue
    }
    let run = ''
    for (const ch of chunk) {
      if (CJK_CHAR.test(ch) || CJK_PUNCT.test(ch)) {
        if (run) {
          tokens.push(run)
          run = ''
        }
        tokens.push(ch)
      } else {
        run += ch
      }
    }
    if (run) tokens.push(run)
  }

  return tokens
}

/**
 * Joins tokens back into display text. Uses a space separator by default,
 * but omits it at a CJK boundary (either side of the join is a CJK
 * character/punctuation mark) so CJK text doesn't end up with a space
 * between every character.
 */
export function joinTokens(parts: string[]): string {
  let result = ''
  for (const part of parts) {
    if (!part) continue
    if (!result) {
      result = part
      continue
    }
    const prevChar = result[result.length - 1]
    const nextChar = part[0]
    const needsSpace = !(CJK_ANY.test(prevChar) || CJK_ANY.test(nextChar))
    result += (needsSpace ? ' ' : '') + part
  }
  return result
}

/** Normalizes a token for cross-referencing text words against timestamped
 *  word entries: lowercase, strip everything but letters/digits (Unicode-
 *  aware, so CJK and accented Latin characters are preserved). */
export function normalizeWord(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

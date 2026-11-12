// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// ---------------------------------------------------------------------------
// Alignment tunables — change values here, not inside the functions.
// ---------------------------------------------------------------------------

/** Matches a token whose visible end is sentence-terminal punctuation.
 *  Includes CJK sentence-final marks (。！？；…) and fullwidth/CJK closing
 *  brackets (」』）) alongside the ASCII set. ，/、 are deliberately excluded
 *  since they're commas, not sentence terminators. */
export const SENTENCE_TERMINATOR = /[.!?。！？；…]+["')\]」』）]*$/

/**
 * Word-reconciliation: bail out of word-level alignment (falling back to the
 * next tier) if more than this fraction of the text tokens can't be matched
 * against the timestamped word list.
 */
export const MAX_DESYNC_FRACTION = 0.15

/**
 * A text token should never require more than this many timestamped word
 * pieces to reconstruct (Whisper's sub-word splits, e.g. "co" + "-worker",
 * "38" + ".5").
 */
export const MAX_PIECES_PER_TOKEN = 4

/**
 * Minimum duration (seconds) attributed to a token when duration-weighting a
 * sentence's speaker vote, so zero-duration (e.g. punctuation-only) tokens
 * still count instead of being silently ignored.
 */
export const MIN_WORD_WEIGHT = 0.01

/**
 * Nudge added to the previous sentence's speaker weight when voting, so a
 * genuine tie doesn't flip-flop the conversation.
 */
export const TIE_BREAK_BONUS = 0.01

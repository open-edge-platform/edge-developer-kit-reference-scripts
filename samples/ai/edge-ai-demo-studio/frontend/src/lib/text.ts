// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** The first sentence of a description, without its Args/parameter blocks. */
export function getFirstSentence(text: string): string {
  const beforeArgs = text.split(/\n\n/)[0].trim()
  const sentenceMatch = beforeArgs.match(/^(.+?[.!?])(?:\s|$)/)
  return sentenceMatch ? sentenceMatch[1] : beforeArgs
}

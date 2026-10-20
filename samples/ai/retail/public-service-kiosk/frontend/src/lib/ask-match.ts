// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Ask } from "@/app/api/_lib/flows/types";
import { fold, foldedWords } from "@/lib/text";

// Which pending option asks a free-text reply answers, on words alone.

const norm = fold;

const words = (label: string) => foldedWords(label);

/** Label words that point at exactly one option — a word shared with a
 *  sibling option identifies nothing. */
function distinctiveWords(ask: Ask): Map<string, string> {
  const seen = new Map<string, string | null>();
  for (const option of ask.options ?? []) {
    for (const word of new Set(words(option.label))) {
      seen.set(word, seen.has(word) ? null : option.value);
    }
  }
  return new Map(
    [...seen].filter((entry): entry is [string, string] => entry[1] !== null),
  );
}

export function matchOption(ask: Ask, text: string): string | null {
  if (ask.type !== "options" || !ask.options) return null;
  const message = norm(text);
  const byValue = ask.options.find((option) => message.includes(norm(option.value)));
  if (byValue) return byValue.value;
  for (const [word, value] of distinctiveWords(ask)) {
    if (message.includes(word)) return value;
  }
  return null;
}

export function matchOptionAnswers(text: string, asks: Ask[]): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const ask of asks) {
    const value = matchOption(ask, text);
    if (value) answers[ask.id] = value;
  }
  return answers;
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { activePack } from "@/packs";

// Locale-safe normalization for the deterministic matchers: plain
// `toLowerCase()` + `[^a-z0-9]+` splitting silently deletes accented letters,
// so a Vietnamese label would match nothing at all.

const lang = () => activePack().locale.language;

/** Case-folded, whitespace-collapsed text, diacritics intact. */
export const fold = (s: string): string =>
  s.normalize("NFKC").toLocaleLowerCase(lang()).replace(/\s+/g, " ").trim();

/** Folded words with short words dropped — the cutoff is the pack's (4 suits
 *  English; an analytic language with short words needs 2). */
export const foldedWords = (s: string, minLength = activePack().locale.minKeywordWordLength) =>
  fold(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= minLength);

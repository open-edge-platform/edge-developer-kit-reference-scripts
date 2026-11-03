// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { z } from "zod";
import { completeText, jsonObjects } from "./llm";

/**
 * One structured answer from the model, validated against `schema` — or null when the model is
 * mocked, down, or answered with anything that does not fit. Callers always have a deterministic
 * fallback: the model may improve an answer, never be the only way to get one. `options` as for
 * `completeText`.
 */
export async function completeJson<T>(
  system: string,
  user: string,
  schema: z.ZodType<T>,
  options: { thinking?: boolean } = {},
): Promise<T | null> {
  const content = await completeText(system, user, options);
  if (!content) return null;
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, "");
  for (const candidate of jsonObjects(cleaned).reverse()) {
    try {
      const parsed = schema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {
      continue;
    }
  }
  return null;
}

/** Lowercased, accent- and punctuation-free text, for checking a model's words against the source it was given. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The model may only repeat what the source says: a value it cannot point to in the OCR text is dropped. */
export function grounded(value: string | null | undefined, source: string): string | null {
  const text = value?.trim();
  if (!text) return null;
  return normalizeText(source).includes(normalizeText(text)) ? text : null;
}

/** A visitor is waiting at the screen: a model slower than this is treated as down. */
const LLM_DEADLINE_MS = 15_000;

export function withinDeadline<T>(work: Promise<T | null>, ms = LLM_DEADLINE_MS): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export const numbersIn = (text: string): number[] => (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

/** Every number the model wrote must be one it was given — no invented times, prices, phone numbers or values. */
export function onlyKnownNumbers(output: string, source: string): boolean {
  const known = new Set(numbersIn(source));
  return numbersIn(output).every((n) => known.has(n));
}

export const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** Untrusted text placed inside a quoted prompt line. */
export const quoted = (text: string, max = 300) =>
  text.replace(/["\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

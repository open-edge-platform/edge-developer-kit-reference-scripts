// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export type SplitCommandLine =
  { ok: true; args: string[] } | { ok: false; error: string }

/**
 * Splits typed arguments like a shell: whitespace separates them, `'…'` is taken as is, and inside
 * `"…"` a backslash escapes `"` or `\`. Other backslashes are kept, so Windows paths survive.
 */
export function splitCommandLine(text: string): SplitCommandLine {
  const args: string[] = []
  let current = ''
  let inArg = false
  let quote: '"' | "'" | null = null

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote === "'") {
      if (char === "'") quote = null
      else current += char
    } else if (quote === '"') {
      if (char === '"') quote = null
      else if (char === '\\' && (text[i + 1] === '"' || text[i + 1] === '\\')) {
        current += text[++i]
      } else current += char
    } else if (char === '"' || char === "'") {
      quote = char
      inArg = true
    } else if (/\s/.test(char)) {
      if (inArg) args.push(current)
      current = ''
      inArg = false
    } else {
      current += char
      inArg = true
    }
  }

  if (quote) return { ok: false, error: `A ${quote} quote is not closed` }
  if (inArg) args.push(current)
  return { ok: true, args }
}

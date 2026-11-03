// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export type ReasoningParserId = 'default' | 'none'

export interface ReasoningParserOption {
  value: ReasoningParserId
  label: string
  description: string
}

// No parser that starts inside reasoning (templates such as Qwen3.5's that open <think> in the
// prompt): OVMS already returns that as `reasoning_content`, so it would show twice.
export const REASONING_PARSER_OPTIONS: ReasoningParserOption[] = [
  {
    value: 'default',
    label: 'Default (<think> … </think>)',
    description:
      'Extract reasoning wrapped in a matched <think></think> pair. Reasoning the server returns separately is shown either way.',
  },
  {
    value: 'none',
    label: 'None',
    description: 'Do not parse <think> tags. The answer is shown as-is.',
  },
]

export const DEFAULT_REASONING_PARSER: ReasoningParserId = 'default'

/** Unknown ids, including stored `auto` and `qwen3.5`, fall back to the default. */
export function resolveReasoningParser(
  requested: string | undefined,
): ReasoningParserId {
  return requested === 'none' ? 'none' : DEFAULT_REASONING_PARSER
}

const THINK_TAG_REGEX = /<\/?think>/gi

/**
 * Strips stray `<think>`/`</think>` tags (Qwen3.5 with thinking off can end a reply with one):
 * Markdown hides them on screen, but not when read aloud or copied.
 */
export function withoutThinkTags(text: string): string {
  return text.replace(THINK_TAG_REGEX, '')
}

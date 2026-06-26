// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export type ReasoningParserId = 'auto' | 'default' | 'qwen3.5' | 'none'

export type ConcreteReasoningParserId = Exclude<ReasoningParserId, 'auto'>

export interface ReasoningParserOption {
  value: ReasoningParserId
  label: string
  description: string
}

export const REASONING_PARSER_OPTIONS: ReasoningParserOption[] = [
  {
    value: 'auto',
    label: 'Auto (recommended)',
    description:
      'Pick the parser that matches the running model. Qwen3.5 models use the Qwen3.5 parser; others use the default <think> parser.',
  },
  {
    value: 'default',
    label: 'Default (<think> … </think>)',
    description:
      'Extract reasoning wrapped in a matched <think></think> pair. Works for most Qwen3 and DeepSeek-R1 style models.',
  },
  {
    value: 'qwen3.5',
    label: 'Qwen3.5 (</think> only)',
    description:
      'Treat output as reasoning until the first </think> tag. Use for Qwen3.5 models, which omit the opening <think> tag.',
  },
  {
    value: 'none',
    label: 'None',
    description: 'Do not parse reasoning. The raw model output is shown as-is.',
  },
]

export const DEFAULT_REASONING_PARSER: ReasoningParserId = 'auto'

/** Choose the parser that best matches a given model name. */
export function getDefaultReasoningParser(
  model: string,
): ConcreteReasoningParserId {
  // Matches "Qwen3.5", "qwen3.5", "Qwen35" but not "Qwen3-1.7B" / "Qwen3-VL".
  return /qwen3\.?5/i.test(model) ? 'qwen3.5' : 'default'
}

/**
 * Resolve a (possibly user-supplied) parser id to a concrete parser. Unknown
 * values and `auto` fall back to the model-aware default.
 */
export function resolveReasoningParser(
  requested: string | undefined,
  model: string,
): ConcreteReasoningParserId {
  if (
    requested === 'default' ||
    requested === 'qwen3.5' ||
    requested === 'none'
  ) {
    return requested
  }
  return getDefaultReasoningParser(model)
}

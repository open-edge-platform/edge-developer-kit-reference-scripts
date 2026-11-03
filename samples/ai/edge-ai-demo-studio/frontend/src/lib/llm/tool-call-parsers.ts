// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * How a chat reads tool calls. Prompt-based parsers work with any instruct model; `native` lets the
 * engine parse them, for models fine-tuned on their chat template's tool format.
 */
export type ToolCallParserId = 'hermes' | 'qwen3coder' | 'native'

export interface ToolCallParserOption {
  value: ToolCallParserId
  label: string
  description: string
}

export const TOOL_CALL_PARSER_OPTIONS: ToolCallParserOption[] = [
  {
    value: 'hermes',
    label: 'Hermes (prompt)',
    description:
      'Describes the tools in the system prompt and reads <tool_call> JSON from the answer. Works with most instruct models.',
  },
  {
    value: 'qwen3coder',
    label: 'Qwen3 Coder XML (prompt)',
    description:
      'Describes the tools in the system prompt and reads Qwen3 Coder style <function=…> XML calls from the answer.',
  },
  {
    value: 'native',
    label: 'Native (llama.cpp)',
    description:
      "No parser: the tools go to the engine as API declarations and the engine returns the calls in the model's own format. Mainly for llama.cpp models fine-tuned on their chat template's tool calls.",
  },
]

export const DEFAULT_TOOL_CALL_PARSER: ToolCallParserId = 'hermes'

/** Unknown ids fall back to the default. */
export function resolveToolCallParser(
  requested: string | undefined,
): ToolCallParserId {
  return (
    TOOL_CALL_PARSER_OPTIONS.find((o) => o.value === requested)?.value ??
    DEFAULT_TOOL_CALL_PARSER
  )
}

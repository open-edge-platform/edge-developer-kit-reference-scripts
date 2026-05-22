// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import type { DemoParam } from '@/types/demo-params'

export const TEXT_GEN_DEFAULTS = {
  maxTokens: 2048,
  temperature: 0.7,
  topP: 0.9,
  topK: 50,
  repetitionPenalty: 1.1,
}

export interface TextGenParamValues {
  maxTokens: number
  temperature: number
  topP: number
  topK: number
  repetitionPenalty: number
  systemPrompt: string
  disableReasoning: boolean
}

export function useTextGenParams(initial?: Partial<TextGenParamValues>): {
  values: TextGenParamValues
  params: DemoParam[]
} {
  const [maxTokens, setMaxTokens] = useState(
    initial?.maxTokens ?? TEXT_GEN_DEFAULTS.maxTokens,
  )
  const [temperature, setTemperature] = useState(
    initial?.temperature ?? TEXT_GEN_DEFAULTS.temperature,
  )
  const [topP, setTopP] = useState(initial?.topP ?? TEXT_GEN_DEFAULTS.topP)
  const [topK, setTopK] = useState(initial?.topK ?? TEXT_GEN_DEFAULTS.topK)
  const [repetitionPenalty, setRepetitionPenalty] = useState(
    initial?.repetitionPenalty ?? TEXT_GEN_DEFAULTS.repetitionPenalty,
  )
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? '')
  const [disableReasoning, setDisableReasoning] = useState(
    initial?.disableReasoning ?? false,
  )

  const values: TextGenParamValues = {
    maxTokens,
    temperature,
    topP,
    topK,
    repetitionPenalty,
    systemPrompt,
    disableReasoning,
  }

  const params: DemoParam[] = [
    {
      type: 'slider',
      id: 'max_tokens',
      label: 'Max Tokens',
      value: maxTokens,
      min: 32,
      max: 16384,
      step: 32,
      onChange: setMaxTokens,
      tooltip: 'The maximum number of tokens that can be generated',
    },
    {
      type: 'slider',
      id: 'temperature',
      label: 'Temperature',
      value: temperature,
      min: 0,
      max: 2,
      step: 0.1,
      onChange: setTemperature,
      tooltip:
        'The value is used to modulate token probabilities for multinomial sampling. It enables multinomial sampling when set to > 0.0.',
    },
    {
      type: 'slider',
      id: 'top_p',
      label: 'Top P',
      value: topP,
      min: 0,
      max: 1,
      step: 0.05,
      onChange: setTopP,
      tooltip:
        'Controls the cumulative probability of the top tokens to consider. Set to 1 to consider all tokens.',
    },
    {
      type: 'slider',
      id: 'top_k',
      label: 'Top K',
      value: topK,
      min: 1,
      max: 100,
      step: 1,
      onChange: setTopK,
      tooltip:
        'Controls the number of top tokens to consider. Set to empty or -1 to consider all tokens.',
    },
    {
      type: 'slider',
      id: 'rep_penalty',
      label: 'Repetition Penalty',
      value: repetitionPenalty,
      min: 1,
      max: 2,
      step: 0.05,
      onChange: setRepetitionPenalty,
      tooltip:
        'Penalizes new tokens based on whether they appear in the prompt and the generated text so far. Values > 1.0 encourage the model to use new tokens, while values < 1.0 encourage the model to repeat tokens. 1.0 means no penalty.',
    },
    {
      type: 'toggle',
      id: 'disable_reasoning',
      label: 'Disable Reasoning',
      tooltip:
        'Disable chain-of-thought reasoning (thinking). Adds /no_think prefix to the system prompt.',
      checked: disableReasoning,
      onChange: setDisableReasoning,
    },
    {
      type: 'textarea',
      id: 'system_prompt',
      label: 'System Prompt',
      placeholder: 'Enter a custom system prompt…',
      value: systemPrompt,
      rows: 3,
      onChange: setSystemPrompt,
    },
  ]

  return { values, params }
}

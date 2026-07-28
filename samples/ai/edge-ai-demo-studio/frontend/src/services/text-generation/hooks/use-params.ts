// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback, useRef, useState } from 'react'
import type { DemoParam } from '@/types/demo-params'
import {
  DEFAULT_REASONING_PARSER,
  REASONING_PARSER_OPTIONS,
  type ReasoningParserId,
} from '@/lib/reasoning-parsers'

const TEXT_GEN_DEFAULTS = {
  maxTokens: 16384,
  temperature: 0.7,
  topP: 0.9,
  topK: 50,
  repetitionPenalty: 1.1,
}

type RequestParamKey =
  'maxTokens' | 'temperature' | 'topP' | 'topK' | 'repetitionPenalty'

export interface TextGenParamValues {
  maxTokens: number
  temperature: number
  topP: number
  topK: number
  repetitionPenalty: number
  systemPrompt: string
  disableReasoning: boolean
  reasoningParser: ReasoningParserId
}

function useTouchedState<T>(
  initial: T,
): [T, (value: T) => void, boolean, () => void] {
  const initialRef = useRef(initial)
  const [value, setValue] = useState(initial)
  const [touched, setTouched] = useState(false)
  const set = useCallback((next: T) => {
    setValue(next)
    setTouched(true)
  }, [])
  const reset = useCallback(() => {
    setValue(initialRef.current)
    setTouched(false)
  }, [])
  return [value, set, touched, reset]
}

interface UseTextGenParamsOptions {
  systemPromptTooltip?: string
}

export function useTextGenParams(
  initial?: Partial<TextGenParamValues>,
  options?: UseTextGenParamsOptions,
): {
  values: TextGenParamValues
  requestParams: Partial<Pick<TextGenParamValues, RequestParamKey>>
  params: DemoParam[]
} {
  const [maxTokens, setMaxTokens, maxTokensTouched, resetMaxTokens] =
    useTouchedState(initial?.maxTokens ?? TEXT_GEN_DEFAULTS.maxTokens)
  const [temperature, setTemperature, temperatureTouched, resetTemperature] =
    useTouchedState(initial?.temperature ?? TEXT_GEN_DEFAULTS.temperature)
  const [topP, setTopP, topPTouched, resetTopP] = useTouchedState(
    initial?.topP ?? TEXT_GEN_DEFAULTS.topP,
  )
  const [topK, setTopK, topKTouched, resetTopK] = useTouchedState(
    initial?.topK ?? TEXT_GEN_DEFAULTS.topK,
  )
  const [
    repetitionPenalty,
    setRepetitionPenalty,
    repetitionPenaltyTouched,
    resetRepetitionPenalty,
  ] = useTouchedState(
    initial?.repetitionPenalty ?? TEXT_GEN_DEFAULTS.repetitionPenalty,
  )
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? '')
  const [disableReasoning, setDisableReasoning] = useState(
    initial?.disableReasoning ?? false,
  )
  const [reasoningParser, setReasoningParser] = useState<ReasoningParserId>(
    initial?.reasoningParser ?? DEFAULT_REASONING_PARSER,
  )

  const values: TextGenParamValues = {
    maxTokens,
    temperature,
    topP,
    topK,
    repetitionPenalty,
    systemPrompt,
    disableReasoning,
    reasoningParser,
  }

  const requestParams: Partial<Pick<TextGenParamValues, RequestParamKey>> = {
    ...(maxTokensTouched ? { maxTokens } : {}),
    ...(temperatureTouched ? { temperature } : {}),
    ...(topPTouched ? { topP } : {}),
    ...(topKTouched ? { topK } : {}),
    ...(repetitionPenaltyTouched ? { repetitionPenalty } : {}),
  }

  const params: DemoParam[] = [
    {
      type: 'slider',
      id: 'max_tokens',
      label: 'Max Tokens',
      value: maxTokens,
      min: 32,
      max: 262144,
      step: 32,
      onChange: setMaxTokens,
      unset: !maxTokensTouched,
      onReset: resetMaxTokens,
      tooltip:
        'The maximum number of tokens that can be generated. On Auto, the model generates up to its maximum (unconstrained).',
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
      unset: !temperatureTouched,
      onReset: resetTemperature,
      tooltip:
        'The value is used to modulate token probabilities for multinomial sampling. It enables multinomial sampling when set to > 0.0. On Auto, the server default is used.',
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
      unset: !topPTouched,
      onReset: resetTopP,
      tooltip:
        'Controls the cumulative probability of the top tokens to consider. Set to 1 to consider all tokens. On Auto, the server default is used.',
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
      unset: !topKTouched,
      onReset: resetTopK,
      tooltip:
        'Controls the number of top tokens to consider. Set to empty or -1 to consider all tokens. On Auto, the server default is used.',
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
      unset: !repetitionPenaltyTouched,
      onReset: resetRepetitionPenalty,
      tooltip:
        'Penalizes new tokens based on whether they appear in the prompt and the generated text so far. Values > 1.0 encourage the model to use new tokens, while values < 1.0 encourage the model to repeat tokens. 1.0 means no penalty. On Auto, the server default is used.',
    },
    {
      type: 'toggle',
      id: 'disable_reasoning',
      label: 'Disable Reasoning',
      tooltip:
        'Disable chain-of-thought reasoning (thinking). Sets the chat template enable_thinking flag to false (works for Qwen3 and Qwen3.5).',
      checked: disableReasoning,
      onChange: setDisableReasoning,
    },
    {
      type: 'select',
      id: 'reasoning_parser',
      label: 'Reasoning Parser',
      tooltip:
        "Controls how the model's thinking (<think>) output is parsed. Auto picks the right parser per model; choose Qwen3.5 for models that omit the opening <think> tag.",
      value: reasoningParser,
      options: REASONING_PARSER_OPTIONS.map((o) => ({
        value: o.value,
        label: o.label,
      })),
      onChange: (v) => setReasoningParser(v as ReasoningParserId),
    },
    {
      type: 'textarea',
      id: 'system_prompt',
      label: 'System Prompt',
      ...(options?.systemPromptTooltip
        ? { tooltip: options.systemPromptTooltip }
        : {}),
      placeholder: 'Enter a custom system prompt…',
      value: systemPrompt,
      rows: 3,
      onChange: setSystemPrompt,
    },
  ]

  return { values, requestParams, params }
}

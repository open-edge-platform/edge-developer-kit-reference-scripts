// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { DemoParam, ParamSlider } from '@/types/demo-params'
import {
  DEFAULT_REASONING_PARSER,
  REASONING_PARSER_OPTIONS,
  type ReasoningParserId,
} from '@/lib/llm/reasoning-parsers'
import { useDemoParams } from '@/services/common/demo/use-demo-params'

const TEXT_GEN_DEFAULTS = {
  maxTokens: 16384,
  temperature: 0.7,
  topP: 0.9,
  topK: 50,
  repetitionPenalty: 1.1,
}

type RequestParamKey =
  'maxTokens' | 'temperature' | 'topP' | 'topK' | 'repetitionPenalty'

/**
 * Sampling params are always sent: the model's own defaults can mean no repetition penalty and
 * looping replies (Qwen3.5-4B int4). `maxTokens` is sent only once set, since OVMS rejects
 * prompt + max tokens beyond the model's length (4096 for Phi-3-mini-4k).
 */
export type RequestParams = Partial<Pick<TextGenParamValues, RequestParamKey>>

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

interface UseTextGenParamsOptions {
  systemPromptTooltip?: string
  /** Keeps the settings per instance across demo remounts under a `DemoSessionProvider`. */
  sessionKey?: string
}

interface ParamState {
  /** Numeric params the user set; the others show (and send) their defaults. */
  custom: RequestParams
  systemPrompt: string
  disableReasoning: boolean
  reasoningParser: ReasoningParserId
}

export function useTextGenParams(
  initial?: Partial<TextGenParamValues>,
  options?: UseTextGenParamsOptions,
): {
  values: TextGenParamValues
  requestParams: RequestParams
  params: DemoParam[]
  /** Settings that differ from their defaults. */
  customCount: number
  resetParams: () => void
} {
  const defaults: ParamState = {
    custom: {},
    systemPrompt: initial?.systemPrompt ?? '',
    disableReasoning: initial?.disableReasoning ?? false,
    reasoningParser: initial?.reasoningParser ?? DEFAULT_REASONING_PARSER,
  }
  const {
    values: state,
    set,
    reset,
  } = useDemoParams(defaults, { sessionKey: options?.sessionKey })
  const { custom, systemPrompt, disableReasoning, reasoningParser } = state

  const seeded = (key: RequestParamKey) =>
    initial?.[key] ?? TEXT_GEN_DEFAULTS[key]

  const values: TextGenParamValues = {
    maxTokens: custom.maxTokens ?? seeded('maxTokens'),
    temperature: custom.temperature ?? seeded('temperature'),
    topP: custom.topP ?? seeded('topP'),
    topK: custom.topK ?? seeded('topK'),
    repetitionPenalty: custom.repetitionPenalty ?? seeded('repetitionPenalty'),
    systemPrompt,
    disableReasoning,
    reasoningParser,
  }

  const customCount =
    Object.keys(custom).length +
    (systemPrompt !== defaults.systemPrompt ? 1 : 0) +
    (disableReasoning !== defaults.disableReasoning ? 1 : 0) +
    (reasoningParser !== defaults.reasoningParser ? 1 : 0)

  const slider = (
    key: RequestParamKey,
    spec: Omit<
      ParamSlider,
      'type' | 'value' | 'onChange' | 'unset' | 'onReset'
    >,
  ): ParamSlider => ({
    type: 'slider',
    ...spec,
    value: values[key],
    unset: custom[key] === undefined,
    onChange: (value) => set('custom', { ...custom, [key]: value }),
    onReset: () => {
      const next = { ...custom }
      delete next[key]
      set('custom', next)
    },
  })

  const params: DemoParam[] = [
    slider('maxTokens', {
      id: 'max_tokens',
      label: 'Max Tokens',
      min: 32,
      max: 262144,
      step: 32,
      unit: 'tokens',
      tooltip:
        'Most tokens to generate. By default the model may generate up to its own limit.',
    }),
    slider('temperature', {
      id: 'temperature',
      label: 'Temperature',
      min: 0,
      max: 2,
      step: 0.1,
      tooltip:
        'Higher values give more varied output; 0 always picks the most likely token. By default the server setting applies.',
    }),
    slider('topP', {
      id: 'top_p',
      label: 'Top P',
      min: 0,
      max: 1,
      step: 0.05,
      advanced: true,
      tooltip:
        'Samples from the most likely tokens whose probabilities add up to this value. 1 considers all tokens.',
    }),
    slider('topK', {
      id: 'top_k',
      label: 'Top K',
      min: 1,
      max: 100,
      step: 1,
      advanced: true,
      tooltip: 'Samples from this many of the most likely tokens.',
    }),
    slider('repetitionPenalty', {
      id: 'rep_penalty',
      label: 'Repetition Penalty',
      min: 1,
      max: 2,
      step: 0.05,
      advanced: true,
      tooltip:
        'Values above 1 discourage repeating tokens from the prompt and the output so far. 1 means no penalty.',
    }),
    {
      type: 'toggle',
      id: 'disable_reasoning',
      label: 'Disable Reasoning',
      tooltip:
        'Asks the model not to reason before answering (sets the chat template enable_thinking flag to false; Qwen3, Qwen3.5 and Gemma 4).',
      checked: disableReasoning,
      onChange: (checked) => set('disableReasoning', checked),
    },
    {
      type: 'select',
      id: 'reasoning_parser',
      label: 'Reasoning Parser',
      advanced: true,
      tooltip:
        'How <think> tags left in the answer are split out as reasoning. Reasoning the server returns separately is shown either way.',
      value: reasoningParser,
      options: REASONING_PARSER_OPTIONS.map((o) => ({
        value: o.value,
        label: o.label,
      })),
      onChange: (v) => {
        const option = REASONING_PARSER_OPTIONS.find((o) => o.value === v)
        if (option) set('reasoningParser', option.value)
      },
    },
    {
      type: 'textarea',
      id: 'system_prompt',
      label: 'System Prompt',
      advanced: true,
      ...(options?.systemPromptTooltip
        ? { tooltip: options.systemPromptTooltip }
        : {}),
      placeholder: 'Enter a custom system prompt…',
      value: systemPrompt,
      rows: 3,
      onChange: (value) => set('systemPrompt', value),
    },
  ]

  const requestParams: RequestParams = {
    ...(custom.maxTokens != null ? { maxTokens: custom.maxTokens } : {}),
    temperature: values.temperature,
    topP: values.topP,
    topK: values.topK,
    repetitionPenalty: values.repetitionPenalty,
  }

  return {
    values,
    requestParams,
    params,
    customCount,
    resetParams: reset,
  }
}

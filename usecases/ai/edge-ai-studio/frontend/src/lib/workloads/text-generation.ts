// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Model } from '@/components/workloads/text-generation/settings'
import { TEXT_GENERATION_PORT } from '@/lib/constants'

export const TEXT_GENERATION_TYPE = 'text-generation' as const

export const TEXT_GENERATION_DESCRIPTION =
  'Generate human-like text using advanced language models running directly in your browser. Perfect for content creation, code generation, and creative writing.'

export const TEXT_GENERATION_MODELS: Model[] = [
  {
    name: 'OpenVINO/Phi-4-mini-instruct-int4-ov',
    value: 'OpenVINO/Phi-4-mini-instruct-int4-ov',
    type: 'predefined',
  },
  {
    name: 'OpenVINO/Phi-3.5-mini-instruct-int4-ov',
    value: 'OpenVINO/Phi-3.5-mini-instruct-int4-ov',
    type: 'predefined',
  },
  {
    name: 'OpenVINO/DeepSeek-R1-Distill-Qwen-7B-int4-ov',
    value: 'OpenVINO/DeepSeek-R1-Distill-Qwen-7B-int4-ov',
    type: 'predefined',
  },
  {
    name: 'OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov',
    value: 'OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov',
    type: 'predefined',
  },
  {
    name: 'OpenVINO/Qwen3-8B-int4-ov',
    value: 'OpenVINO/Qwen3-8B-int4-ov',
    type: 'predefined',
  },
  {
    name: 'OpenVINO/Qwen3-4B-int4-ov',
    value: 'OpenVINO/Qwen3-4B-int4-ov',
    type: 'predefined',
  },
  { name: 'Qwen/Qwen2.5-3B', value: 'Qwen/Qwen2.5-3B', type: 'predefined' },
  { name: 'Qwen/Qwen3-8B', value: 'Qwen/Qwen3-8B', type: 'predefined' },
]

export const TEXT_GENERATION_WORKLOAD = {
  name: TEXT_GENERATION_TYPE,
  type: TEXT_GENERATION_TYPE,
  model: TEXT_GENERATION_MODELS[0].value,
  device: 'CPU',
  port: TEXT_GENERATION_PORT,
  healthUrl: '/v1/config',
}

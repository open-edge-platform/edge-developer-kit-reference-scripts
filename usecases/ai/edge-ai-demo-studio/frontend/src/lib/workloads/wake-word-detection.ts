// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Model } from '@/components/workloads/wake-word-detection/settings'
import { WAKE_WORD_DETECTION_PORT } from '@/lib/constants'
import { CreateWorkload } from '@/types/workload'

export const WAKE_WORD_DETECTION_TYPE = 'wake-word-detection' as const

export const WAKE_WORD_DETECTION_DESCRIPTION =
  'Detect wake words with openWakeWord. Ideal for voice-activated applications and hands-free control.'

export const WAKE_WORD_DETECTION_MODELS: Model[] = [
  {
    name: 'hey_jarvis_v0.1',
    value: 'hey_jarvis_v0.1.onnx',
    type: 'predefined',
  },
  {
    name: 'alexa_v0.1',
    value: 'alexa_v0.1.onnx',
    type: 'predefined',
  },
  {
    name: 'hey_mycroft_v0.1',
    value: 'hey_mycroft_v0.1.onnx',
    type: 'predefined',
  },
  {
    name: 'hey_rhasspy_v0.1',
    value: 'hey_rhasspy_v0.1.onnx',
    type: 'predefined',
  },
  {
    name: 'timer_v0.1',
    value: 'timer_v0.1.onnx',
    type: 'predefined',
  },
  {
    name: 'weather_v0.1',
    value: 'weather_v0.1.onnx',
    type: 'predefined',
  },
]

export const WAKE_WORD_DETECTION_URL = `/api/wake-word-detection`

export const WAKE_WORD_DETECTION_WORKLOAD: CreateWorkload = {
  name: WAKE_WORD_DETECTION_TYPE,
  type: WAKE_WORD_DETECTION_TYPE,
  models: {
    default: { name: WAKE_WORD_DETECTION_MODELS[0].value, device: 'CPU' },
  },
  port: WAKE_WORD_DETECTION_PORT,
  metadata: {
    vadThreshold: 0.2,
  },
  engine: 'custom' as const,
  healthCheck: { url: '/healthcheck' },
}

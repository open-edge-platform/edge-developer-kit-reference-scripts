// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Model } from '@/components/workloads/speech-to-text/settings'
import { SPEECH_TO_TEXT_PORT } from '@/lib/constants'

export const SPEECH_TO_TEXT_TYPE = 'speech-to-text' as const

export const SPEECH_TO_TEXT_DESCRIPTION =
  'Convert speech to text using OpenVINO-optimized Whisper models. Supports multiple languages, audio formats, and optional noise suppression for improved accuracy.'

export const SPEECH_TO_TEXT_MODELS: Model[] = [
  {
    name: 'OpenVINO/whisper-tiny-int8-ov',
    value: 'OpenVINO/whisper-tiny-int8-ov',
    type: 'predefined',
  },
  {
    name: 'openai/whisper-tiny',
    value: 'openai/whisper-tiny',
    type: 'predefined',
  },
  {
    name: 'openai/whisper-base',
    value: 'openai/whisper-base',
    type: 'predefined',
  },
  {
    name: 'openai/whisper-small',
    value: 'openai/whisper-small',
    type: 'predefined',
  },
  {
    name: 'openai/whisper-medium',
    value: 'openai/whisper-medium',
    type: 'predefined',
  },
]

export const STT_DENOISE_MODELS: Model[] = [
  {
    name: 'noise-suppression-poconetlike-0001',
    value: 'noise-suppression-poconetlike-0001',
    type: 'predefined',
  },
  {
    name: 'noise-suppression-denseunet-ll-0001',
    value: 'noise-suppression-denseunet-ll-0001',
    type: 'predefined',
  },
]

export const SPEECH_TO_TEXT_WORKLOAD = {
  name: SPEECH_TO_TEXT_TYPE,
  type: SPEECH_TO_TEXT_TYPE,
  model: SPEECH_TO_TEXT_MODELS[0].value,
  device: 'CPU',
  port: SPEECH_TO_TEXT_PORT,
  metadata: {
    denoise_model: STT_DENOISE_MODELS[0].value,
    denoise_device: 'CPU',
  },
  healthUrl: '/healthcheck',
}

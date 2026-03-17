// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { SPEECH_TO_TEXT_PORT } from '@/lib/constants'
import { CreateWorkload, Model } from '@/types/workload'

export const SPEECH_TO_TEXT_TYPE = 'speech-to-text' as const

export const SPEECH_TO_TEXT_DESCRIPTION =
  'Convert speech to text using OpenVINO-optimized Whisper models. Supports multiple languages, audio formats, and optional noise suppression for improved accuracy.'

export const SPEECH_TO_TEXT_URL = '/api/speech-to-text'

export const SPEECH_TO_TEXT_MODELS: Model[] = [
  {
    name: 'OpenVINO/whisper-base-int8-ov',
    device: 'CPU',
  },
  {
    name: 'OpenVINO/whisper-tiny-int8-ov',
    device: 'CPU',
  },
  {
    name: 'openai/whisper-tiny',
    device: 'CPU',
  },
  {
    name: 'openai/whisper-base',
    device: 'CPU',
  },
  {
    name: 'openai/whisper-small',
    device: 'CPU',
  },
  {
    name: 'openai/whisper-medium',
    device: 'CPU',
  },
]

export const STT_DENOISE_MODELS: Model[] = [
  {
    name: 'noise-suppression-poconetlike-0001',
    device: 'CPU',
  },
  {
    name: 'noise-suppression-denseunet-ll-0001',
    device: 'CPU',
  },
]

export const SPEECH_TO_TEXT_WORKLOAD: CreateWorkload = {
  name: SPEECH_TO_TEXT_TYPE,
  type: SPEECH_TO_TEXT_TYPE,
  models: { default: SPEECH_TO_TEXT_MODELS[0], denoise: STT_DENOISE_MODELS[0] },
  port: SPEECH_TO_TEXT_PORT,
  healthCheck: { url: '/healthcheck' },
  engine: 'custom',
}

export const SUPPORTED_STT_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ms', name: 'Malay' },
  { code: 'zh', name: 'Chinese' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ja', name: 'Japanese' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
]

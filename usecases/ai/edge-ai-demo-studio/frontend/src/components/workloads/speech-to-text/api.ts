// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { EndpointProps } from '../endpoint'

export const speechToTextEndpoints: EndpointProps[] = [
  {
    title: 'Speech-to-Text Transcription API',
    description:
      'Convert speech to text using OpenVINO-optimized Whisper models with optional denoising.',
    path: '/v1/audio/transcriptions',
    method: 'POST',
    headers: `Content-Type: multipart/form-data`,
    formData: ['file=@audio_file.wav', 'language=en', 'use_denoise=false'],
    exampleResponse: `{
  "text": "Hello, this is a test transcription.",
  "status": true
}`,
    parameters: [
      {
        name: 'file',
        description:
          'The audio file to transcribe. Supported formats include WAV, MP3, M4A, WEBM, and other common audio formats.',
        required: true,
      },
      {
        name: 'language',
        description:
          'The language of the audio. Use ISO 639-1 language codes (e.g., "en" for English, "es" for Spanish). Supported languages: en, ms, zh, hi, ja, es, fr, it, pt. Defaults to "en" if not specified.',
        required: false,
      },
      {
        name: 'use_denoise',
        description:
          'Whether to apply noise suppression to the audio before transcription. Can improve accuracy for noisy audio. Defaults to false.',
        required: false,
      },
    ],
  },
  {
    title: 'Speech-to-Text Translation API',
    description:
      'Translate speech from any supported language to English text.',
    path: '/v1/audio/translations',
    method: 'POST',
    headers: `Content-Type: multipart/form-data`,
    formData: ['file=@non_english_audio.wav', 'language=fr'],
    exampleResponse: `{
  "text": "Hello, this is a translated text.",
  "status": true
}`,
    parameters: [
      {
        name: 'file',
        description:
          'The audio file to translate. Supported formats include WAV, MP3, M4A, WEBM, and other common audio formats.',
        required: true,
      },
      {
        name: 'language',
        description:
          'The source language of the audio to translate from. Use ISO 639-1 language codes. The output will always be in English.',
        required: false,
      },
    ],
  },
]

export const speechToTextModels = [
  {
    name: 'Whisper Tiny',
    value: 'openai/whisper-tiny',
    type: 'transcription',
    description: 'Fastest model with good accuracy for most use cases',
    size: '~39MB',
    languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh'],
  },
  {
    name: 'Whisper Base',
    value: 'openai/whisper-base',
    type: 'transcription',
    description: 'Balanced speed and accuracy',
    size: '~74MB',
    languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh'],
  },
  {
    name: 'Whisper Small',
    value: 'openai/whisper-small',
    type: 'transcription',
    description: 'Higher accuracy with moderate speed',
    size: '~244MB',
    languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh'],
  },
  {
    name: 'Whisper Medium',
    value: 'openai/whisper-medium',
    type: 'transcription',
    description: 'High accuracy for professional use',
    size: '~769MB',
    languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh'],
  },
  {
    name: 'Whisper Large v3',
    value: 'openai/whisper-large-v3',
    type: 'transcription',
    description: 'Best accuracy, slower processing',
    size: '~1550MB',
    languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh'],
  },
]

export const denoiseModels = [
  {
    name: 'PocoNet-like Noise Suppression',
    value: 'noise-suppression-poconetlike-0001',
    type: 'denoising',
    description: 'Intel OpenVINO optimized noise suppression model',
    device_support: ['CPU', 'GPU', 'NPU'],
  },
  {
    name: 'DenseUNet Noise Suppression',
    value: 'noise-suppression-denseunet-ll-0001',
    type: 'denoising',
    description: 'Alternative Intel OpenVINO noise suppression model',
    device_support: ['CPU', 'GPU'],
  },
]

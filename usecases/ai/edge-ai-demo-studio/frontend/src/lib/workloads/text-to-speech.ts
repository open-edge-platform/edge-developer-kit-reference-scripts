// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { TEXT_TO_SPEECH_PORT } from '@/lib/constants'

export const TEXT_TO_SPEECH_TYPE = 'text-to-speech' as const

export const TEXT_TO_SPEECH_DESCRIPTION =
  'Convert text to natural-sounding speech using advanced TTS models running locally. Perfect for accessibility, voice assistants, and more.'

export const TEXT_TO_SPEECH_WORKLOAD = {
  name: TEXT_TO_SPEECH_TYPE,
  model: 'kokoro',
  device: 'CPU',
  type: TEXT_TO_SPEECH_TYPE,
  port: TEXT_TO_SPEECH_PORT,
  healthUrl: '/healthcheck',
}

// Language/Model Options
export const TTS_MODELS = [
  {
    label: 'Kokoro TTS',
    model: 'kokoro',
    type: 'OpenVINO',
    cpuOnly: true,
    languages: [
      {
        name: 'American English',
        id: 'en-US',
        voices: [
          'af_alloy',
          'af_aoede',
          'af_bella',
          'af_heart',
          'af_jadzia',
          'af_jessica',
          'af_kore',
          'af_nicole',
          'af_nova',
          'af_river',
          'af_sarah',
          'af_sky',
          'am_adam',
          'am_echo',
          'am_eric',
          'am_fenrir',
          'am_liam',
          'am_michael',
          'am_onyx',
          'am_puck',
          'am_santa',
        ],
      },
      {
        name: 'British English',
        id: 'en-GB',
        voices: [
          'bf_alice',
          'bf_emma',
          'bf_lily',
          'bm_daniel',
          'bm_fable',
          'bm_george',
          'bm_lewis',
        ],
      },
      {
        name: 'Spanish',
        id: 'es-ES',
        voices: ['ef_dora', 'em_alex', 'em_santa'],
      },
      {
        name: 'French',
        id: 'fr-FR',
        voices: ['ff_siwis'],
      },
      {
        name: 'Hindi',
        id: 'hi-IN',
        voices: ['hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi'],
      },
      {
        name: 'Italian',
        id: 'it-IT',
        voices: ['if_sara', 'im_nicola'],
      },
      {
        name: 'Japanese',
        id: 'ja-JP',
        voices: [
          'jf_alpha',
          'jf_gongitsune',
          'jf_nezumi',
          'jf_tebukuro',
          'jm_kumo',
        ],
      },
      {
        name: 'Brazilian Portuguese',
        id: 'pt-BR',
        voices: ['pf_dora', 'pm_alex', 'pm_santa'],
      },
      {
        name: 'Mandarin Chinese',
        id: 'zh-CN',
        voices: [
          'zf_xiaobei',
          'zf_xiaoni',
          'zf_xiaoxiao',
          'zf_xiaoyi',
          'zm_yunjian',
          'zm_yunxi',
          'zm_yunxia',
          'zm_yunyang',
        ],
      },
    ],
  },
  {
    label: 'Malaya TTS',
    model: 'malaya',
    type: 'PyTorch',
    cpuOnly: false,
    languages: [
      {
        name: 'Bahasa Malaysia',
        id: 'ms-MY',
        voices: ['Husein', 'Shafiqah Idayu', 'Anwar Ibrahim'],
      },
    ],
  },
]

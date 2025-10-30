// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { EndpointProps } from '../endpoint'

export const textToSpeechEndpoints: EndpointProps[] = [
  {
    title: 'Kokoro TTS Speech API',
    description:
      'Generate spoken audio from input text using the OpenAI-compatible Kokoro TTS endpoint.',
    path: '/v1/audio/speech',
    body: `{
  "model": "kokoro",
  "input": "Today is a wonderful day to build something people love!",
  "voice": "af_heart",
  "response_format": "mp3",
  "download_format": "mp3",
  "speed": 1,
  "stream": true,
  "return_download_link": false,
  "lang_code": "a",
  "normalization_options": {
    "normalize": true,
    "unit_normalization": false,
    "url_normalization": true,
    "email_normalization": true,
    "optional_pluralization_normalization": true,
    "phone_normalization": true
  }
}`,
    method: 'POST',
    headers: `Content-Type: application/json`,
    exampleResponse: `// Binary audio data (e.g., mp3, wav, etc.) will be returned in the response body.\n// If return_download_link is true, a download link will be provided in the X-Download-Path header.`,
    parameters: [
      {
        name: 'model',
        description:
          'The model to use for generation. Supported models: tts-1, tts-1-hd, kokoro. Default: kokoro.',
      },
      {
        name: 'input',
        description: 'The text to generate audio for.',
        required: true,
      },
      {
        name: 'voice',
        description:
          'The voice to use for generation. Can be a base voice or a combined voice name. Default: af_heart.',
      },
      {
        name: 'response_format',
        description:
          'The format to return audio in. Supported formats: mp3, opus, flac, wav, pcm. PCM format returns raw 16-bit samples without headers. AAC is not currently supported. Default: mp3.',
        required: false,
      },
      {
        name: 'download_format',
        description:
          'Optional different format for the final download. If not provided, uses response_format.',
        required: false,
      },
      {
        name: 'speed',
        description:
          'The speed of the generated audio. Select a value from 0.25 to 4.0. Default: 1.0.',
        required: false,
      },
      {
        name: 'stream',
        description:
          "If true (default), audio will be streamed as it's generated. Each chunk will be a complete sentence. Default: true.",
        required: false,
      },
      {
        name: 'return_download_link',
        description:
          'If true, returns a download link in X-Download-Path header after streaming completes. Default: false.',
        required: false,
      },
      {
        name: 'lang_code',
        description:
          'Optional language code to use for text processing. If not provided, will use first letter of voice name.',
        required: false,
      },
      {
        name: 'volume_multiplier',
        description:
          'A volume multiplier to multiply the output audio by. Default: 1.0.',
        required: false,
      },
      {
        name: 'normalization_options',
        description: 'Options for the normalization system.',
        required: false,
      },
    ],
  },
  {
    title: 'Kokoro TTS Voices API',
    description:
      'List all available voices for text-to-speech synthesis using the Kokoro TTS endpoint.',
    path: '/v1/audio/voices',
    method: 'GET',
    exampleResponse: `{
  'voices': [
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
    'af_v0', 
    'af_v0bella', 
    'af_v0irulan', 
    'af_v0nicole', 
    'af_v0sarah', 
    'af_v0sky', 
    'am_adam', 
    'am_echo', 
    'am_eric', 
    'am_fenrir', 
    'am_liam', 
    'am_michael', 
    'am_onyx', 
    'am_puck', 
    'am_santa', 
    'am_v0adam', 
    'am_v0gurney', 
    'am_v0michael', 
    'bf_alice', 
    'bf_emma', 
    'bf_lily', 
    'bf_v0emma', 
    'bf_v0isabella', 
    'bm_daniel', 
    'bm_fable', 
    'bm_george', 
    'bm_lewis', 
    'bm_v0george', 
    'bm_v0lewis', 
    'ef_dora', 
    'em_alex', 
    'em_santa', 
    'ff_siwis', 
    'hf_alpha', 
    'hf_beta', 
    'hm_omega', 
    'hm_psi', 
    'if_sara', 
    'im_nicola', 
    'jf_alpha', 
    'jf_gongitsune', 
    'jf_nezumi', 
    'jf_tebukuro', 
    'jm_kumo', 
    'pf_dora', 
    'pm_alex', 
    'pm_santa', 
    'zf_xiaobei', 
    'zf_xiaoni', 
    'zf_xiaoxiao', 
    'zf_xiaoyi', 
    'zm_yunjian', 
    'zm_yunxi', 
    'zm_yunxia', 
    'zm_yunyang'
  ]
}`,
  },
]

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDocsData } from '@/services/types'

export const getDocsData = ({ host }: { host: string }): ServiceDocsData => ({
  overview:
    'The Text to Speech (TTS) service converts text into natural-sounding speech using the Kokoro TTS model with OpenVINO acceleration. It supports multiple voices, adjustable speed, streaming audio output, and multiple output formats.',
  endpoints: [
    {
      method: 'POST',
      path: '/v1/audio/speech',
      description: 'Convert text to speech audio',
      params: [
        {
          name: 'input',
          type: 'string',
          required: true,
          desc: 'The text to generate audio for',
        },
        {
          name: 'voice',
          type: 'string',
          required: false,
          desc: "Voice ID for generation (default: 'af_heart')",
        },
        {
          name: 'speed',
          type: 'float',
          required: false,
          desc: 'Speed multiplier 0.25–4.0 (default: 1.0)',
        },
        {
          name: 'response_format',
          type: 'string',
          required: false,
          desc: 'Output format: mp3, wav, ogg (default: mp3)',
        },
        {
          name: 'stream',
          type: 'boolean',
          required: false,
          desc: 'Stream audio as it is generated (default: true)',
        },
        {
          name: 'lang_code',
          type: 'string',
          required: false,
          desc: "Language code for text processing (default: 'a' for auto)",
        },
      ],
    },
    {
      method: 'GET',
      path: '/v1/audio/voices',
      description: 'List all available voices for text-to-speech synthesis',
    },
  ],
  sampleCode: [
    {
      title: 'Sample code',
      codeSnippets: [
        {
          language: 'Python',
          languageCode: 'python',
          code: `import requests

response = requests.post(
    "${host}/v1/audio/speech",
    json={
        "input": "Hello from Intel Edge AI.",
        "voice": "af_heart",
        "speed": 1.0,
        "response_format": "mp3",
        "stream": False,
    },
)

with open("output.mp3", "wb") as f:
    f.write(response.content)`,
        },
        {
          language: 'cURL',
          languageCode: 'bash',
          code: `curl -X POST ${host}/v1/audio/speech \\
  -H "Content-Type: application/json" \\
  -d '{"input": "Hello from Intel Edge AI.", "voice": "af_heart", "stream": false}' \\
  --output output.mp3`,
        },
      ],
    },
  ],
  responseExample: `# Binary audio response (MP3 format)
# Headers:
Content-Type: audio/mpeg
# Streamed or returned as a single response depending on "stream" parameter`,
})

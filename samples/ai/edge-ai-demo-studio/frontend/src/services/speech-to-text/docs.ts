// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDocsData } from '@/services/types'

export const getDocsData = ({ host }: { host: string }): ServiceDocsData => ({
  overview:
    'The Speech to Text (STT) service provides real-time speech recognition using Whisper models optimized for Intel hardware with OpenVINO. Supports 99+ languages, batch transcription, and audio denoising.',
  endpoints: [
    {
      method: 'POST',
      path: '/v1/audio/transcriptions',
      description: 'Transcribe audio file to text',
      params: [
        {
          name: 'file',
          type: 'file (binary)',
          required: true,
          desc: 'Audio file (WAV, MP3, FLAC, OGG, WebM)',
        },
        {
          name: 'language',
          type: 'string',
          required: false,
          desc: "Language code, e.g. 'en' (default: 'en')",
        },
        {
          name: 'use_denoise',
          type: 'boolean',
          required: false,
          desc: 'Apply noise suppression before transcription (default: false)',
        },
        {
          name: 'return_timestamps',
          type: 'boolean',
          required: false,
          desc: 'Return per-chunk timestamps alongside the transcript (default: false). When true, the response includes a `segments` array of `{ start, end, text }` objects.',
        },
      ],
    },
    {
      method: 'POST',
      path: '/v1/audio/translations',
      description: 'Translate audio to English text',
      params: [
        {
          name: 'file',
          type: 'file (binary)',
          required: true,
          desc: 'Audio file (WAV, MP3, FLAC, OGG, WebM)',
        },
        {
          name: 'language',
          type: 'string',
          required: false,
          desc: "Source language code (default: 'en')",
        },
      ],
    },
    {
      method: 'GET',
      path: '/healthcheck',
      description: 'Health check endpoint',
    },
  ],
  sampleCode: [
    {
      title: 'Sample code',
      codeSnippets: [
        {
          language: 'Python',
          languageCode: 'python',
          code: `import requests\n\nwith open("audio.wav", "rb") as f:\n    response = requests.post(\n        "${host}/v1/audio/transcriptions",\n        files={"file": f},\n        data={"language": "en", "use_denoise": False, "return_timestamps": True}\n    )\n\nresult = response.json()\nprint(result["text"])\nfor seg in result.get("segments", []):\n    print(f"[{seg['start']:.2f}s - {seg['end']:.2f}s] {seg['text']}")`,
        },
        {
          language: 'cURL',
          languageCode: 'bash',
          code: `curl -X POST ${host}/v1/audio/transcriptions \\\n  -F "file=@recording.wav" \\\n  -F "language=en" \\\n  -F "return_timestamps=true"`,
        },
      ],
    },
  ],
  responseExample: `// Default response\n{\n  "text": "Hello, welcome to the demo.",\n  "status": true\n}\n\n// When return_timestamps=true\n{\n  "text": "Hello, welcome to the demo.",\n  "status": true,\n  "segments": [\n    { "start": 0.0, "end": 1.4, "text": "Hello," },\n    { "start": 1.4, "end": 3.2, "text": "welcome to the demo." }\n  ]\n}`,
})

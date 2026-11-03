// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDocsData } from '@/services/types'

export const getDocsData = ({ host }: { host: string }): ServiceDocsData => ({
  quickStart: {
    steps: [
      "Start listening on the server's microphone with `POST /v1/wake-word-detection/start`.",
      'Read detections from `GET /v1/wake-word-detection/events`, or follow `GET /v1/wake-word-detection/events/stream` as Server-Sent Events.',
      'Optionally, subscribe a webhook with `POST /v1/wake-word-detection/webhooks/subscribe` to have each detection POSTed to your app.',
    ],
    request: {
      language: 'cURL',
      languageCode: 'bash',
      code: `curl ${host}/v1/wake-word-detection/models/list`,
    },
  },
  serviceDescription:
    "The Wake Word Detection service listens on the server's microphone for configurable wake words using OpenWakeWord models and sends webhook notifications when detections occur.",
  overview:
    'Event-driven wake word detection server that monitors audio input for custom wake words. Supports webhook subscriptions, dynamic model management (upload, reload, delete ONNX models), audio device selection, and configurable VAD thresholds. Detections are broadcast to registered webhook subscribers with model name, confidence score, and timestamp.',
  endpoints: [
    {
      method: 'POST',
      path: '/v1/wake-word-detection/webhooks/subscribe',
      description:
        'Subscribe a webhook URL to receive wake word detection events. Each call times out after 5 seconds; notifications a slow subscriber cannot keep up with are dropped rather than delaying detection.',
      params: [
        {
          name: 'url',
          type: 'string',
          required: true,
          desc: 'The webhook endpoint URL that will receive POST requests on detection.',
        },
        {
          name: 'name',
          type: 'string',
          required: false,
          desc: 'Optional display name for the subscriber.',
        },
        {
          name: 'threshold',
          type: 'number',
          required: false,
          desc: 'Confidence threshold for triggering webhook (0.0–1.0, default 0.6).',
        },
        {
          name: 'api_key',
          type: 'string',
          required: false,
          desc: 'Optional API key sent as Authorization header with webhook calls.',
        },
      ],
    },
    {
      method: 'PATCH',
      path: '/v1/wake-word-detection/webhooks/subscriber',
      description: 'Update an existing webhook subscriber by URL.',
      params: [
        {
          name: 'url',
          type: 'string',
          required: true,
          desc: 'The webhook URL to update.',
        },
        {
          name: 'name',
          type: 'string',
          required: false,
          desc: 'Updated display name.',
        },
        {
          name: 'threshold',
          type: 'number',
          required: false,
          desc: 'Updated confidence threshold.',
        },
        {
          name: 'api_key',
          type: 'string',
          required: false,
          desc: 'Updated API key.',
        },
      ],
    },
    {
      method: 'DELETE',
      path: '/v1/wake-word-detection/webhooks/unsubscribe',
      description: 'Unsubscribe a webhook URL from detection events.',
      params: [
        {
          name: 'url',
          type: 'string',
          required: true,
          desc: 'The webhook URL to unsubscribe.',
        },
      ],
    },
    {
      method: 'GET',
      path: '/v1/wake-word-detection/webhooks/subscribers',
      description: 'List all active webhook subscribers.',
    },
    {
      method: 'POST',
      path: '/v1/wake-word-detection/start',
      description:
        "Start listening for wake words on the server's microphone. Detections are recorded whether or not any webhook is subscribed. Answers 503 with the reason in `detail` when there is nothing to listen on: the server has no microphone, or not the `device_id` asked for.",
      params: [
        {
          name: 'device_id',
          type: 'integer',
          required: false,
          desc: 'Audio input device ID. Use /audio-devices to list available devices.',
        },
      ],
    },
    {
      method: 'POST',
      path: '/v1/wake-word-detection/stop',
      description: 'Stop listening for wake words.',
    },
    {
      method: 'POST',
      path: '/v1/wake-word-detection/detect',
      description:
        "Look for the loaded wake words in an uploaded recording instead of the microphone. Answers each model's best score and the second it first reached the threshold. Live detection is unaffected, and nothing is recorded or sent to webhooks.",
      params: [
        {
          name: 'file',
          type: 'file',
          required: true,
          desc: 'Recording in any format ffmpeg reads (WAV, MP3, ...).',
        },
        {
          name: 'threshold',
          type: 'number',
          required: false,
          desc: 'Score (0.0–1.0) that counts as a detection. Default 0.5.',
        },
      ],
    },
    {
      method: 'GET',
      path: '/v1/wake-word-detection/events/stream',
      description:
        'Follow detections and the microphone level as Server-Sent Events. The stream opens with an "events" event listing the buffered detections, then sends "detection" for each new one, "cleared" when the buffer is cleared, and "level" (level, active) about ten times a second while detection runs.',
      params: [
        {
          name: 'since',
          type: 'string',
          required: false,
          desc: 'ISO timestamp; the opening "events" only lists detections after it.',
        },
      ],
    },
    {
      method: 'GET',
      path: '/v1/wake-word-detection/events',
      description: 'Recent detection events, newest first (up to 200).',
      params: [
        {
          name: 'since',
          type: 'string',
          required: false,
          desc: 'ISO timestamp; only events after it are returned.',
        },
      ],
    },
    {
      method: 'GET',
      path: '/v1/wake-word-detection/audio-level',
      description:
        'Current microphone input RMS level (0.0–1.0) and whether detection is active.',
    },
    {
      method: 'GET',
      path: '/v1/wake-word-detection/audio-devices',
      description: 'List available audio input devices (microphones).',
    },
    {
      method: 'POST',
      path: '/v1/wake-word-detection/models/upload',
      description: 'Upload a custom wake word model in ONNX format.',
      params: [
        {
          name: 'file',
          type: 'file',
          required: true,
          desc: 'ONNX model file to upload.',
        },
      ],
    },
    {
      method: 'POST',
      path: '/v1/wake-word-detection/models/reload',
      description:
        'Reload wake word models dynamically. Detection must be stopped first.',
      params: [
        {
          name: 'model_filenames',
          type: 'string[]',
          required: true,
          desc: 'List of model filenames to load.',
        },
        {
          name: 'vad_threshold',
          type: 'number',
          required: false,
          desc: 'VAD threshold for voice activity detection (0.0–1.0).',
        },
      ],
    },
    {
      method: 'GET',
      path: '/v1/wake-word-detection/models/list',
      description:
        'List all available wake word models and currently loaded models.',
    },
    {
      method: 'DELETE',
      path: '/v1/wake-word-detection/models/delete/{filename}',
      description:
        'Delete a wake word model. Detection must be stopped and model unloaded.',
    },
    {
      method: 'POST',
      path: '/v1/wake-word-detection/webhooks/test-webhook',
      description: 'Send a test webhook to all subscribers.',
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

# Subscribe a webhook
requests.post(f"${host}/v1/wake-word-detection/webhooks/subscribe", json={
    "url": "https://your-app.example.com/webhook",
    "name": "My App",
    "threshold": 0.7,
})

# Start detection
requests.post(f"${host}/v1/wake-word-detection/start")

# Stop detection
requests.post(f"${host}/v1/wake-word-detection/stop")`,
        },
        {
          language: 'cURL',
          languageCode: 'bash',
          code: `# Subscribe a webhook
curl -X POST ${host}/v1/wake-word-detection/webhooks/subscribe \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://your-app.example.com/webhook", "name": "My App", "threshold": 0.7}'

# Start detection
curl -X POST ${host}/v1/wake-word-detection/start

# List models
curl ${host}/v1/wake-word-detection/models/list`,
        },
      ],
    },
  ],
  responseExample: `{
  "event": "wake_word_detected",
  "model": "hey_jarvis_v0.1",
  "score": 0.717,
  "timestamp": "2025-11-28T10:30:00.123456",
  "message": "Wake word 'hey_jarvis_v0.1' detected!"
}`,
})

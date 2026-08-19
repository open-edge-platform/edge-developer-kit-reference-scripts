// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDocsData } from '@/services/types'
// get port for STT
import { service as sttService } from '@/services/speech-to-text/data'

export const getDocsData = ({ host }: { host: string }): ServiceDocsData => ({
  overview:
    'The Speech to Text (STT) service provides real-time speech recognition using Whisper models optimized for Intel hardware with OpenVINO. Supports 99+ languages, batch transcription, audio denoising, and a WebSocket endpoint for live microphone streaming with automatic utterance segmentation.',
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
      ],
    },
    {
      method: 'GET',
      path: '/v1/audio/stream  (WebSocket)',
      description: `Live microphone streaming endpoint. The client pushes raw 16-bit little-endian PCM audio (mono, 16 kHz) as binary frames; a Silero VAD segments the stream into utterances and each finished utterance is transcribed and returned as JSON as soon as it completes. Send a JSON text frame \`{"event": "stop"}\` to flush the pending utterance and end the session. Tuning parameters (language, VAD thresholds, etc.) are passed as query params on connect. Note: unlike the REST endpoints above, this WebSocket must be reached directly on the worker port ${sttService.port}.`,
      params: [
        {
          name: 'language',
          type: 'string (query)',
          required: false,
          desc: "Language code, e.g. 'en' (default: 'en')",
        },
        {
          name: 'min_silence_duration_ms',
          type: 'number (query)',
          required: false,
          desc: 'Silence duration that ends an utterance, in milliseconds (default: 500)',
        },
        {
          name: 'max_continuous_speech_s',
          type: 'number (query)',
          required: false,
          desc: 'Maximum utterance length before a forced cut, in seconds (default: 15)',
        },
        {
          name: 'latency_log',
          type: 'boolean (query)',
          required: false,
          desc: 'Log per-utterance latency breakdown on the server (default: false)',
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
    {
      title: 'Live audio streaming (WebSocket) — mic or a local .wav file',
      codeSnippets: [
        {
          language: 'JavaScript',
          languageCode: 'javascript',
          code: `// Paste into the DevTools console on any Edge AI Demo Studio page to test live
// streaming end-to-end, no app code required. Connects directly to the
// worker's own port -- the /api/speech-to-text proxy only forwards HTTP
// requests, not the WebSocket upgrade handshake.
const SAMPLE_RATE = 16000
const FRAME_SAMPLES = 800 // ~50ms per frame, matches the app's own mic capture

const workerHost = location.hostname === 'localhost' ? '127.0.0.1' : location.hostname
const ws = new WebSocket(\`ws://\${workerHost}:${sttService.port}/v1/audio/stream?language=en\`)
ws.onclose = () => console.log('[stt] closed')
ws.onerror = (e) => console.error('[stt] error', e)
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  console.log(
    msg.type === 'transcript'
      ? \`[\${msg.start.toFixed(2)}s-\${msg.end.toFixed(2)}s] \${msg.text}\`
      : msg,
  )
}
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
console.log('[stt] connected')

function floatTo16BitPCM(float32) {
  const pcm16 = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return pcm16
}

// Sends one Float32 buffer as fixed-size frames, paced in real time so the
// server's VAD behaves as it would for a live mic.
async function streamFloat32(float32) {
  for (let offset = 0; offset < float32.length; offset += FRAME_SAMPLES) {
    ws.send(floatTo16BitPCM(float32.subarray(offset, offset + FRAME_SAMPLES)).buffer)
    await new Promise((r) => setTimeout(r, (FRAME_SAMPLES / SAMPLE_RATE) * 1000))
  }
}

// Option A -- stream the microphone:
async function streamFromMic() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
  const workletCode =
    "class PcmWorklet extends AudioWorkletProcessor {\\n" +
    "  process(inputs) {\\n" +
    "    const channel = inputs[0] && inputs[0][0]\\n" +
    "    if (channel) this.port.postMessage(channel.slice(0))\\n" +
    "    return true\\n" +
    "  }\\n" +
    "}\\n" +
    "registerProcessor('pcm-worklet', PcmWorklet)"
  const workletUrl = URL.createObjectURL(new Blob([workletCode], { type: 'application/javascript' }))
  await ctx.audioWorklet.addModule(workletUrl)
  const node = new AudioWorkletNode(ctx, 'pcm-worklet')
  node.port.onmessage = (e) => streamFloat32(e.data)
  ctx.createMediaStreamSource(stream).connect(node)
  console.log('[stt] mic streaming -- speak, then run: ws.send(JSON.stringify({ event: "stop" }))')
}

// Option B -- mock a live stream from a local .wav file instead of a mic:
async function streamFromWavFile(file) {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
  const audioBuffer = await ctx.decodeAudioData(await file.arrayBuffer())
  await streamFloat32(audioBuffer.getChannelData(0)) // channel 0 only (mono)
  ws.send(JSON.stringify({ event: 'stop' }))
  console.log('[stt] finished streaming wav file')
}

// Now run ONE of the following:
//   await streamFromMic()
// -- or --
//   const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.wav,audio/wav' })
//   input.onchange = (e) => streamFromWavFile(e.target.files[0])
//   input.click()`,
        },
      ],
    },
  ],
  responseExample: `// Default response\n{\n  "text": "Hello, welcome to the demo.",\n  "status": true\n}\n\n// When return_timestamps=true\n{\n  "text": "Hello, welcome to the demo.",\n  "status": true,\n  "segments": [\n    { "start": 0.0, "end": 1.4, "text": "Hello," },\n    { "start": 1.4, "end": 3.2, "text": "welcome to the demo." }\n  ]\n}\n\n// WebSocket /v1/audio/stream messages\n{ "type": "ready" }\n{ "type": "speech_start" }\n{ "type": "transcript", "text": "Hello there", "start": 0.5, "end": 2.1, "latency": { "endpoint_ms": 120, "queue_ms": 5, "stt_ms": 340, "e2e_ms": 465 } }\n{ "type": "error", "message": "..." }\n{ "type": "done" }`,
})

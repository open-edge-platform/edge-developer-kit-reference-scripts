// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type {
  CodeSample,
  DocsFactoryOptions,
  ServiceDocsData,
} from '@/services/types'
import { getSttBackend, type SttBackendId } from './config'

interface LiveSnippetBackend {
  name: string
  /** Socket path and query. */
  path: string
  /** Body of `ws.onmessage`, given the parsed `msg`. */
  onMessage: string
  /** Helpers plus `sendFrame(pcm16)`, which sends one Int16Array frame. */
  sendFrame: string
  /** The message that flushes the pending utterance and ends the session. */
  stopMessage: string
}

const LIVE_SNIPPET_BACKENDS: Record<'oep' | 'ovms', LiveSnippetBackend> = {
  oep: {
    name: 'OEP backend',
    path: '/v1/realtime?intent=transcription&language=en',
    onMessage: `  if (msg.type === 'conversation.item.input_audio_transcription.completed') {
    console.log('[stt] transcript:', msg.transcript)
  } else if (msg.type === 'error') {
    console.error('[stt] error:', msg.error)
  } else {
    console.log('[stt]', msg.type)
  }`,
    sendFrame: `function toBase64(buffer) {
  let binary = ''
  for (const b of new Uint8Array(buffer)) binary += String.fromCharCode(b)
  return btoa(binary)
}

function sendFrame(pcm16) {
  ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: toBase64(pcm16.buffer) }))
}`,
    stopMessage: `{ type: 'session.close' }`,
  },
  ovms: {
    name: 'OpenVINO Model Server backend',
    path: '/v1/audio/stream?language=en',
    onMessage: `  console.log(
    msg.type === 'transcript'
      ? \`[\${msg.start.toFixed(2)}s-\${msg.end.toFixed(2)}s] \${msg.text}\`
      : msg,
  )`,
    sendFrame: `function sendFrame(pcm16) {
  ws.send(pcm16.buffer)
}`,
    stopMessage: `{ event: 'stop' }`,
  },
}

/** DevTools console snippet streaming the mic or a local .wav to `backend`'s live WebSocket. */
function liveStreamingSection(
  backend: 'oep' | 'ovms',
  port: number | undefined,
): CodeSample {
  const { name, path, onMessage, sendFrame, stopMessage } =
    LIVE_SNIPPET_BACKENDS[backend]
  return {
    title: `Live audio streaming (WebSocket, ${name}) — mic or a local .wav file`,
    codeSnippets: [
      {
        language: 'JavaScript',
        languageCode: 'javascript',
        code: `// Paste into the DevTools console on any Edge AI Demo Studio page to test live
// streaming end-to-end, no app code required. Needs the ${name}
// (Runtime Settings -> Backend). Connects directly to the worker's own port --
// the /api/speech-to-text@<instance> proxy only forwards HTTP requests, not the
// WebSocket upgrade handshake.
const SAMPLE_RATE = 16000
const FRAME_SAMPLES = 800 // ~50ms per frame, matches the app's own mic capture

const workerHost = location.hostname === 'localhost' ? '127.0.0.1' : location.hostname
const ws = new WebSocket(\`ws://\${workerHost}:${port ?? '<worker port>'}${path}\`)
ws.onclose = () => console.log('[stt] closed')
ws.onerror = (e) => console.error('[stt] error', e)
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
${onMessage}
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

${sendFrame}

// Sends one Float32 buffer as fixed-size frames, paced in real time so the
// server's VAD behaves as it would for a live mic.
async function streamFloat32(float32) {
  for (let offset = 0; offset < float32.length; offset += FRAME_SAMPLES) {
    sendFrame(floatTo16BitPCM(float32.subarray(offset, offset + FRAME_SAMPLES)))
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
  node.port.onmessage = (e) => sendFrame(floatTo16BitPCM(e.data))
  ctx.createMediaStreamSource(stream).connect(node)
  console.log('[stt] mic streaming -- speak, then run: ws.send(JSON.stringify(${stopMessage.replaceAll("'", '"')}))')
}

// Option B -- mock a live stream from a local .wav file instead of a mic:
async function streamFromWavFile(file) {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
  const audioBuffer = await ctx.decodeAudioData(await file.arrayBuffer())
  await streamFloat32(audioBuffer.getChannelData(0)) // channel 0 only (mono)
  ws.send(JSON.stringify(${stopMessage}))
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
  }
}

const BACKENDS: { id: SttBackendId; label: string }[] = [
  { id: 'oep', label: 'OEP backend' },
  { id: 'ovms', label: 'OpenVINO Model Server backend' },
]

/** The quick start's last step: what the selected backend adds. */
const BACKEND_STEP: Record<SttBackendId | 'any', string> = {
  oep: 'This instance runs the OEP backend: add `stream=true` for Server-Sent Events, and send live microphone audio to the `/v1/realtime` WebSocket.',
  ovms: 'This instance runs the OpenVINO Model Server backend: `POST /v1/audio/translations` translates to English, and live microphone audio goes to the `/v1/audio/stream` WebSocket.',
  any: 'Streaming and live microphone transcription depend on the backend chosen under Runtime Settings; the endpoints below are marked with theirs.',
}

// The WebSocket endpoints bypass the HTTP proxy, so they need the worker's own `port`.
export const getDocsData = ({
  host,
  port,
  metadata,
}: DocsFactoryOptions): ServiceDocsData => {
  const activeBackend = metadata ? getSttBackend(metadata) : undefined
  return {
    quickStart: {
      steps: [
        'Upload an audio file to `POST /v1/audio/transcriptions` as multipart form data (field `file`; WAV, MP3, M4A, FLAC, OGG or WebM).',
        'Read the transcript from `text`. Ask for `response_format=verbose_json` for timed segments, or `srt` or `vtt` for subtitles.',
        BACKEND_STEP[activeBackend ?? 'any'],
      ],
      request: {
        language: 'cURL',
        languageCode: 'bash',
        code: `curl ${host}/v1/audio/transcriptions \\
  -F "file=@recording.wav" \\
  -F "language=en"`,
      },
    },
    backends: BACKENDS,
    activeBackend,
    overview:
      "The Speech to Text (STT) service transcribes audio on one of two backends, chosen under Runtime Settings → Backend. The Open Edge Platform audio-analyzer backend (default) runs Whisper on OpenVINO GenAI with an OpenAI-compatible transcription API (batch, SSE and NDJSON streaming, subtitle formats) and an OpenAI Realtime-style WebSocket (`/v1/realtime`) for live microphone input with server-side voice activity detection; speaker diarization and voice sentiment are optional upstream features (see the worker README). The OpenVINO Model Server backend serves Whisper and Qwen3-ASR through OVMS for batch transcription and translation to English, with optional noise suppression, and a live-microphone WebSocket (`/v1/audio/stream`) that segments the stream into utterances with Silero VAD and transcribes each one as it ends. Both answer the same batch endpoint, so clients need no changes when the backend is switched. Both are OpenAI-compatible end to end: the paths, request fields and response bodies match OpenAI's Audio API, errors carry the `{ error: { message, type, param, code } }` envelope OpenAI SDKs read, and `GET /v1/models` reports what is loaded — so an OpenAI SDK pointed at this base URL works unchanged.",
    endpoints: [
      {
        method: 'POST',
        path: '/v1/audio/transcriptions',
        description:
          'Transcribe an audio file (OpenAI-compatible; both backends). On the OEP backend, set `stream=true` to receive Server-Sent Events instead of a single response.',
        params: [
          {
            name: 'file',
            type: 'file (binary)',
            required: true,
            desc: 'Audio file (WAV, MP3, M4A, FLAC, OGG, WebM; MP4/MKV/MOV/AVI video containers are accepted and the audio track is used)',
          },
          {
            name: 'model',
            type: 'string',
            required: false,
            desc: "Ignored for OpenAI compatibility (use 'whisper-1'); the configured model is used",
          },
          {
            name: 'language',
            type: 'string',
            required: false,
            desc: "Language code, e.g. 'en' (default: 'en'). On the OpenVINO Model Server backend, 'auto' lets the model detect it; verbose_json's `language` is then null, since OVMS does not report which",
          },
          {
            name: 'response_format',
            type: 'string',
            required: false,
            desc: "'json' (default), 'text', 'verbose_json' (adds language, duration and OpenAI-shaped `segments` — `{ id, seek, start, end, text, tokens, temperature, avg_logprob, compression_ratio, no_speech_prob }`, plus `words` when word granularity is requested), 'srt' or 'vtt'",
          },
          {
            name: 'use_denoise',
            type: 'boolean',
            required: false,
            backends: ['ovms'],
            desc: 'OpenVINO Model Server backend only: run the OpenVINO noise-suppression model over the audio before transcribing (default: false). Ignored by the OEP backend.',
          },
          {
            name: 'temperature',
            type: 'number',
            required: false,
            desc: 'Sampling temperature between 0 and 1 (default: 0)',
          },
          {
            name: 'prompt',
            type: 'string',
            required: false,
            desc: 'Accepted for OpenAI compatibility; neither backend applies it yet (OpenVINO Model Server and the OEP audio-analyzer both ignore it)',
          },
          {
            name: 'timestamp_granularities[]',
            type: 'string[]',
            required: false,
            desc: "'segment' (default) and/or 'word'. Requires response_format=verbose_json; repeat the field or pass it once comma-separated. On the OpenVINO Model Server backend, Qwen3-ASR's word timings come from a forced aligner (Qwen3-ForcedAligner-0.6B) that starts on the first word request unless the instance's alignerWarmStart setting is on, so that request is slower; `words` is empty when the model gives none.",
          },
          {
            name: 'stream',
            type: 'boolean',
            required: false,
            backends: ['oep'],
            desc: 'OEP backend: stream `transcript.text.delta` / `transcript.text.done` SSE events, then `[DONE]` (json and verbose_json only). The OVMS backend answers 400.',
          },
          {
            name: 'session_id',
            type: 'string',
            required: false,
            backends: ['oep'],
            desc: 'OEP backend: append to an existing session (returned in the `X-Session-ID` response header) so transcripts accumulate across requests',
          },
        ],
      },
      {
        method: 'POST',
        path: '/v1/audio/translations',
        backends: ['ovms'],
        description:
          'OpenVINO Model Server backend: translate an audio file to English text (OpenAI-compatible). Whisper Large v3 Turbo and Qwen3-ASR only transcribe and answer 400.',
        params: [
          {
            name: 'file',
            type: 'file (binary)',
            required: true,
            desc: 'Audio file, same formats as above',
          },
          {
            name: 'model',
            type: 'string',
            required: false,
            desc: 'Accepted for OpenAI compatibility; the configured model is used',
          },
          {
            name: 'response_format',
            type: 'string',
            required: false,
            desc: "'json' (default), 'text', 'verbose_json', 'srt' or 'vtt' — the same set as transcriptions. OpenVINO Model Server returns no timings for translations, so `verbose_json`, `srt` and `vtt` carry one segment over the whole file",
          },
          {
            name: 'prompt',
            type: 'string',
            required: false,
            desc: 'Accepted for OpenAI compatibility; OpenVINO Model Server ignores it',
          },
          {
            name: 'temperature',
            type: 'number',
            required: false,
            desc: 'Sampling temperature between 0 and 1 (default: 0)',
          },
        ],
      },
      {
        method: 'POST',
        path: '/v1/audio/transcriptions/stream',
        backends: ['oep'],
        description:
          'OEP backend: transcribe an audio file and stream one JSON object per line (NDJSON) as each chunk completes: `transcription.chunk` events followed by `transcription.completed`.',
        params: [
          {
            name: 'file',
            type: 'file (binary)',
            required: true,
            desc: 'Audio file, same formats as above',
          },
          {
            name: 'language',
            type: 'string',
            required: false,
            desc: "Language code, e.g. 'en' (default: 'en')",
          },
        ],
      },
      {
        method: 'GET',
        path: '/v1/realtime  (WebSocket)',
        backends: ['oep'],
        description: `OEP backend: live microphone streaming endpoint compatible with the OpenAI Realtime transcription protocol. Send JSON events: \`{"type":"input_audio_buffer.append","audio":"<base64 pcm16>"}\` with 16-bit little-endian mono PCM at 16 kHz; a server-side VAD splits the stream into utterances and each one is transcribed and returned as \`conversation.item.input_audio_transcription.delta\` / \`.completed\` events. Note that \`transcript\` is cumulative for the session (utterances joined with newlines), so clients take the new suffix per event. \`input_audio_buffer.commit\` forces the current utterance to be transcribed, \`session.update\` changes language or VAD settings, and \`session.close\` flushes pending speech and closes the socket. Note: unlike the REST endpoints above, this WebSocket must be reached directly on the worker port ${port ?? 'shown here while the service runs'}.`,
        params: [
          {
            name: 'intent',
            type: 'string (query)',
            required: false,
            desc: "Must be 'transcription' (default)",
          },
          {
            name: 'language',
            type: 'string (query)',
            required: false,
            desc: "Language code, e.g. 'en' (default: auto-detect)",
          },
          {
            name: 'session_id',
            type: 'string (query)',
            required: false,
            desc: 'Reuse a session id so utterances accumulate into one transcript (default: generated)',
          },
        ],
      },
      {
        method: 'GET',
        path: '/v1/audio/stream  (WebSocket)',
        backends: ['ovms'],
        description: `OpenVINO Model Server backend: live microphone streaming endpoint. The client pushes raw 16-bit little-endian PCM audio (mono, 16 kHz) as binary frames; a Silero VAD segments the stream into utterances, reporting \`speech_start\` when it hears speech and \`speech_end\` when it cuts the utterance (\`queued: false\` when it was too short to transcribe), and each queued utterance is transcribed and returned as a \`transcript\` message as soon as it completes (\`text\` empty when nothing was recognised). Send a JSON text frame \`{"event": "stop"}\` to flush the pending utterance and end the session. Tuning parameters (language, VAD thresholds, etc.) are passed as query params on connect. Note: unlike the REST endpoints above, this WebSocket must be reached directly on the worker port ${port ?? 'shown here while the service runs'}.`,
        params: [
          {
            name: 'language',
            type: 'string (query)',
            required: false,
            desc: "Language code, e.g. 'en', or 'auto' to let the model detect it per utterance (default: 'en')",
          },
          {
            name: 'pause_duration',
            type: 'number (query)',
            required: false,
            desc: 'Silence that ends an utterance, in seconds, counted in whole 0.5 s analysis chunks (default: 0.5)',
          },
          {
            name: 'vad_threshold',
            type: 'number (query)',
            required: false,
            desc: 'Silero speech probability (0–1) that counts as speech; lower hears quieter speech and more noise (default: 0.5)',
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
        path: '/v1/models',
        description:
          "List the models this worker answers for, in the OpenAI models shape: the configured model (Whisper, or Qwen3-ASR on the OpenVINO Model Server backend) and the alias 'whisper-1'. `GET /v1/models/{id}` retrieves one.",
      },
      {
        method: 'GET',
        path: '/v1/model-info',
        description:
          'Report the configured model, provider (openvino GenAI or ovms), device and the backend capabilities',
      },
      {
        method: 'GET',
        path: '/v1/performance',
        backends: ['oep'],
        description:
          'OEP backend: transcription latency statistics for this process',
      },
      {
        method: 'GET',
        path: '/healthcheck',
        description:
          'Health check endpoint: 503 while the model is being exported and loaded, 200 once the service can transcribe. The body names the running `backend` ("oep" or "ovms") and the active model.',
      },
    ],
    sampleCode: [
      {
        title: 'Sample code',
        codeSnippets: [
          {
            language: 'Python',
            languageCode: 'python',
            code: `import requests\n\nwith open("audio.wav", "rb") as f:\n    response = requests.post(\n        "${host}/v1/audio/transcriptions",\n        files={"file": f},\n        data={"model": "whisper-1", "language": "en", "response_format": "verbose_json"}\n    )\n\nresult = response.json()\nprint(result["text"])\nfor seg in result.get("segments", []):\n    print(f"[{seg['start']:.2f}s - {seg['end']:.2f}s] {seg['text']}")`,
          },
          {
            language: 'cURL',
            languageCode: 'bash',
            code: `curl -X POST ${host}/v1/audio/transcriptions \\\n  -F "file=@recording.wav" \\\n  -F "model=whisper-1" \\\n  -F "language=en" \\\n  -F "response_format=verbose_json"\n\n# OpenVINO Model Server backend: noise suppression first\ncurl -X POST ${host}/v1/audio/transcriptions \\\n  -F "file=@recording.wav" \\\n  -F "language=en" \\\n  -F "use_denoise=true"`,
          },
          {
            language: 'OpenAI SDK (Python)',
            languageCode: 'python',
            code: `from openai import OpenAI\n\nclient = OpenAI(base_url="${host}/v1", api_key="not-needed")\n\nwith open("audio.wav", "rb") as f:\n    transcript = client.audio.transcriptions.create(\n        model="whisper-1",\n        file=f,\n        language="en",\n    )\nprint(transcript.text)`,
          },
        ],
      },
      // The selected instance's backend first.
      ...(activeBackend === 'ovms'
        ? (['ovms', 'oep'] as const)
        : (['oep', 'ovms'] as const)
      ).map((backend) => liveStreamingSection(backend, port)),
    ],
    responseExample: `// response_format=json (default)\n{\n  "text": "Hello, welcome to the demo."\n}\n\n// response_format=verbose_json\n{\n  "language": "en",\n  "duration": 3.2,\n  "text": "Hello, welcome to the demo.",\n  "segments": [\n    { "id": 0, "start": 0.0, "end": 1.4, "text": "Hello," },\n    { "id": 1, "start": 1.4, "end": 3.2, "text": "welcome to the demo." }\n  ]\n}\n\n// GET /healthcheck\n{ "status": "ok", "service": "speech-to-text", "backend": "oep", "active_model": "openai/whisper-base", "device": "CPU", "model_loaded": true }\n\n// WebSocket /v1/realtime events (server -> client, OEP backend)\n{ "type": "transcription_session.created", "session": { "id": "...", "input_audio_format": "pcm16", "sample_rate": 16000, "turn_detection": { "type": "server_vad", "threshold": 0.02, "prefix_padding_ms": 300, "silence_duration_ms": 500 } } }\n{ "type": "input_audio_buffer.speech_started" }\n{ "type": "input_audio_buffer.speech_stopped" }\n{ "type": "input_audio_buffer.committed", "item_id": "item_...", "reason": "server_vad" }\n{ "type": "conversation.item.input_audio_transcription.delta", "item_id": "item_...", "delta": "Hello there" }\n{ "type": "conversation.item.input_audio_transcription.completed", "item_id": "item_...", "transcript": "Hello there", "language": "en" }\n{ "type": "error", "error": { "type": "server_error", "message": "..." } }\n\n// WebSocket /v1/audio/stream messages (server -> client, OVMS backend)\n{ "type": "ready" }\n{ "type": "speech_start" }\n{ "type": "speech_end", "queued": true }\n{ "type": "transcript", "text": "Hello there", "start": 0.5, "end": 2.1, "latency": { "endpoint_ms": 120, "queue_ms": 5, "stt_ms": 340, "e2e_ms": 465 } }\n{ "type": "error", "message": "..." }\n{ "type": "done" }`,
  }
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDocsData } from '@/services/types'

export const getDocsData = ({ host }: { host: string }): ServiceDocsData => ({
  quickStart: {
    steps: [
      'Send the text to `POST /v1/audio/speech` as JSON. Without a `voice` the model speaks in its default one; `GET /v1/audio/voices` lists the others.',
      'Save the answer as audio: MP3 by default, or set `response_format` to `wav`, `opus`, `aac`, `flac` or `pcm`.',
    ],
    request: {
      language: 'cURL',
      languageCode: 'bash',
      code: `curl ${host}/v1/audio/speech \\
  -H "Content-Type: application/json" \\
  -d '{"input": "Hello from Intel Edge AI."}' \\
  --output speech.mp3`,
    },
  },
  overview:
    'The Text to Speech (TTS) service converts text into natural-sounding speech behind one OpenAI-compatible API. Every model answers POST /v1/audio/speech with OpenAI’s request fields and all six of its response formats (mp3, opus, aac, flac, wav, pcm), so an OpenAI SDK pointed at this base URL works unchanged — including the default, mp3. The built-in workers (Kokoro, Piper, Malaya for Malay, Pocket TTS for Indonesian, VieNeu-TTS for Vietnamese and FastSpeech2 HS for Tamil) support many voices and languages and adjustable speed. Selecting SpeechT5 instead runs the Open Edge Platform text-to-speech microservice natively: English only, voices bundled with the model, and the same routes plus upstream’s /v1/model-info and /v1/performance. That microservice synthesises WAV; the worker re-encodes it to whichever format was asked for and applies `speed`, neither of which upstream handles itself.',
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
          desc: "Voice ID for generation (Kokoro default 'af_heart'; SpeechT5 'Ryan', 'Miles', 'Aaron', 'Nora', 'Elena', 'Kabir', 'Angus')",
        },
        {
          name: 'model',
          type: 'string',
          required: false,
          desc: 'Accepted for OpenAI compatibility; the model the service is configured with is the one that answers',
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
          desc: "One of OpenAI's six: 'mp3' (default), 'opus', 'aac', 'flac', 'wav', 'pcm' (signed 16-bit mono at the model's own sample rate: 24 kHz for Kokoro and Pocket TTS, 48 kHz for VieNeu-TTS, 22.05 kHz for Malaya and FastSpeech2 HS). The OEP models additionally accept 'json' for upstream's base64 WAV + metadata envelope.",
        },
        {
          name: 'stream',
          type: 'boolean',
          required: false,
          desc: "Send the audio sentence by sentence as it is synthesized instead of the whole file (default: true on the built-in workers; false on SpeechT5, which then synthesizes one sentence per model call). 'wav' starts with a header whose sizes are 0xFFFFFFFF (read to the end of the body), 'pcm' is bare samples, 'mp3'/'aac' arrive per sentence, 'opus'/'flac' once complete. A streamed answer carries no Server-Timing header.",
        },
        {
          name: 'stream_format',
          type: 'string',
          required: false,
          desc: "'audio' (default) sends the audio bytes; 'sse' sends OpenAI's event stream — `speech.audio.delta` events whose `audio` is base64 of the next bytes of that same file, then `speech.audio.done` with `duration` and `perf` ({ seconds, audio_seconds }) — streamed whatever `stream` says. A failure mid-stream ends it with an `error` event ({ detail }).",
        },
        {
          name: 'lang_code',
          type: 'string',
          required: false,
          desc: "Language code for text processing (default: 'a' for auto). Kokoro only.",
        },
      ],
    },
    {
      method: 'GET',
      path: '/v1/models',
      description:
        'List the model this worker serves, in the OpenAI models shape. `GET /v1/models/{id}` retrieves one.',
    },
    {
      method: 'GET',
      path: '/v1/audio/voices',
      description:
        'List voices. Built-in workers return { voiceId: downloaded }; the OEP models return the upstream model-info document with supported_speakers.',
    },
  ],
  sampleCode: [
    {
      title: 'Built-in workers (Kokoro shown)',
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
    {
      title: 'Streaming (any model)',
      codeSnippets: [
        {
          language: 'Python',
          languageCode: 'python',
          code: `import base64, json, requests

# Raw 16-bit PCM, played or saved as each sentence is synthesized.
with requests.post(
    "${host}/v1/audio/speech",
    json={"input": "First sentence. Second sentence.", "response_format": "pcm", "stream": True},
    stream=True,
) as response:
    with open("output.pcm", "wb") as f:
        for chunk in response.iter_content(chunk_size=None):
            f.write(chunk)

# The same audio as OpenAI's server-sent events.
with requests.post(
    "${host}/v1/audio/speech",
    json={"input": "First sentence. Second sentence.", "response_format": "wav", "stream_format": "sse"},
    stream=True,
) as response:
    audio = b""
    for line in response.iter_lines():
        if line.startswith(b"data: "):
            event = json.loads(line[6:])
            if event.get("type") == "speech.audio.delta":
                audio += base64.b64decode(event["audio"])`,
        },
        {
          language: 'cURL',
          languageCode: 'bash',
          code: `curl -N -X POST ${host}/v1/audio/speech \\
  -H "Content-Type: application/json" \\
  -d '{"input": "First sentence. Second sentence.", "response_format": "wav", "stream": true}' \\
  --output output.wav`,
        },
      ],
    },
    {
      title: 'OpenAI SDK (any model)',
      codeSnippets: [
        {
          language: 'Python',
          languageCode: 'python',
          code: `from openai import OpenAI

client = OpenAI(base_url="${host}/v1", api_key="unused")

# No response_format given, so the SDK's default (mp3) is used.
with client.audio.speech.with_streaming_response.create(
    model="tts-1",
    voice="af_heart",
    input="Hello from Intel Edge AI.",
) as response:
    response.stream_to_file("output.mp3")`,
        },
        {
          language: 'JavaScript',
          languageCode: 'javascript',
          code: `import OpenAI from 'openai'
import { writeFile } from 'node:fs/promises'

const client = new OpenAI({ baseURL: '${host}/v1', apiKey: 'unused' })

const response = await client.audio.speech.create({
  model: 'tts-1',
  voice: 'af_heart',
  input: 'Hello from Intel Edge AI.',
  response_format: 'aac',
})

await writeFile('output.aac', Buffer.from(await response.arrayBuffer()))`,
        },
      ],
    },
    {
      title: 'SpeechT5 (OEP)',
      codeSnippets: [
        {
          language: 'Python',
          languageCode: 'python',
          code: `import requests

response = requests.post(
    "${host}/v1/audio/speech",
    json={
        "input": "Hello from Intel Edge AI.",
        "voice": "Ryan",
        "response_format": "mp3",
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
  -d '{"input": "Hello from Intel Edge AI.", "voice": "Ryan", "response_format": "mp3"}' \\
  --output output.mp3`,
        },
      ],
    },
  ],
  responseExample: `# Binary audio response, Content-Type per response_format:
#   mp3 -> audio/mpeg   opus -> audio/opus   aac -> audio/aac
#   flac -> audio/flac  wav  -> audio/wav    pcm -> audio/pcm
# "stream": true sends it sentence by sentence as it is synthesized
# "stream_format": "sse" sends, instead:
#   event: speech.audio.delta
#   data: {"type": "speech.audio.delta", "audio": "<base64>"}
#   event: speech.audio.done
#   data: {"type": "speech.audio.done", "duration": 3.2,
#          "perf": {"seconds": 0.41, "audio_seconds": 3.2}}
# OEP models add the header X-Session-ID: <id> to a whole-file answer`,
})

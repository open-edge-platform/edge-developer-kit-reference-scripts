// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDocsData } from '@/services/types'

export const getDocsData = ({ host }: { host: string }): ServiceDocsData => ({
  overview:
    'The Speaker Diarization service identifies and separates speakers in audio recordings. It exposes two endpoints: one for generating a speaker embedding (voice print) and one for running full speaker diarization. Diarization runs asynchronously: `POST /v1/diarize` submits a job and returns a job ID immediately; poll `GET /v1/diarize/{job_id}` for status and the final results. Without a reference embedding, segments are returned with generic IDs (e.g. `SPEAKER_00`). When a reference embedding is provided, the best-matching speaker receives a custom label.\n\n**Model used** (unmodified, credit: [pyannote](https://huggingface.co/pyannote)):\n- [`pyannote/speaker-diarization-community-1`](https://huggingface.co/pyannote/speaker-diarization-community-1) — a single pipeline that produces both the speaker diarization segments and the per-speaker embeddings (voice prints) used for voice enrollment and speaker matching. © pyannote, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).',
  endpoints: [
    {
      method: 'POST',
      path: '/v1/embedding',
      description:
        'Generate a normalized speaker embedding vector from an audio file for voice enrollment.',
      params: [
        {
          name: 'file',
          type: 'file (binary)',
          required: true,
          desc: 'WAV audio file containing the speaker voice sample (minimum 3 seconds recommended).',
        },
      ],
    },
    {
      method: 'POST',
      path: '/v1/diarize',
      description:
        'Submit an asynchronous speaker diarization job. The endpoint returns {"job_id": "<id>"} immediately; poll GET /v1/diarize/{job_id} to check status ("pending" | "completed" | "error") and retrieve the final segments when completed. Optionally provide a reference speaker embedding to assign custom labels to matched speakers.',
      params: [
        {
          name: 'file',
          type: 'file (binary)',
          required: true,
          desc: 'WAV audio file to diarize.',
        },
        {
          name: 'reference_embedding',
          type: 'string (JSON)',
          required: false,
          desc: 'JSON-encoded list of floats representing a known speaker embedding from /v1/embedding.',
        },
        {
          name: 'reference_label',
          type: 'string',
          required: false,
          desc: 'Label for the speaker whose embedding best matches reference_embedding. Defaults to "Reference".',
        },
        {
          name: 'other_label',
          type: 'string',
          required: false,
          desc: 'Label for all other speakers. Defaults to "Other".',
        },
        {
          name: 'num_speakers',
          type: 'integer',
          required: false,
          desc: 'Optional hint for the expected number of speakers.',
        },
      ],
    },
    {
      method: 'GET',
      path: '/v1/diarize/{job_id}',
      description:
        'Poll the status of an async diarization job. Returns {"status": "pending"} while processing, {"status": "completed", "result": {"segments": [...]}} on success, or {"status": "error", "error": "..."} on failure.',
      params: [
        {
          name: 'job_id',
          type: 'string',
          required: true,
          desc: 'Job ID returned by POST /v1/diarize.',
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
      title: 'Speaker Embedding',
      codeSnippets: [
        {
          language: 'Python',
          languageCode: 'python',
          code: `import requests\n\nresponse = requests.post(\n    "${host}/v1/embedding",\n    files={"file": open("voice_sample.wav", "rb")},\n)\nembedding = response.json()["embedding"]\nprint(f"Embedding length: {len(embedding)}")`,
        },
        {
          language: 'cURL',
          languageCode: 'bash',
          code: `curl -X POST ${host}/v1/embedding \\\n  -F "file=@voice_sample.wav"`,
        },
      ],
    },
    {
      title: 'Speaker Diarization',
      codeSnippets: [
        {
          language: 'Python',
          languageCode: 'python',
          code: `import requests, json, time\n\n# Enroll a reference speaker\nref = requests.post(\n    "${host}/v1/embedding",\n    files={"file": open("speaker_a.wav", "rb")},\n)\nreference_embedding = ref.json()["embedding"]\n\n# Submit async diarization job\nresponse = requests.post(\n    "${host}/v1/diarize",\n    files={"file": open("conversation.wav", "rb")},\n    data={\n        "reference_embedding": json.dumps(reference_embedding),\n        "reference_label": "Speaker A",\n        "other_label": "Speaker B",\n        "num_speakers": 2,\n    },\n)\njob_id = response.json()["job_id"]\n\n# Poll until completed\nwhile True:\n    status = requests.get(f"${host}/v1/diarize/{job_id}").json()\n    if status["status"] == "completed":\n        break\n    if status["status"] == "error":\n        raise RuntimeError(status["error"])\n    time.sleep(1)\n\nfor seg in status["result"]["segments"]:\n    print(f"{seg['speaker']:12s}  {seg['start']:.1f}s - {seg['end']:.1f}s")`,
        },
        {
          language: 'cURL',
          languageCode: 'bash',
          code: `# Submit the job\nJOB_ID=$(curl -s -X POST ${host}/v1/diarize \\\n  -F "file=@conversation.wav" \\\n  -F "reference_label=Speaker A" \\\n  -F "other_label=Speaker B" \\\n  -F "num_speakers=2" | jq -r '.job_id')\n\n# Poll until completed\nwhile true; do\n  RESULT=$(curl -s ${host}/v1/diarize/$JOB_ID)\n  STATUS=$(echo $RESULT | jq -r '.status')\n  [ "$STATUS" != "pending" ] && break\n  sleep 1\ndone\n\necho $RESULT | jq '.result.segments'`,
        },
      ],
    },
  ],
  responseExample: `// POST /v1/diarize\n{ "job_id": "a3f2c1d4..." }\n\n// GET /v1/diarize/{job_id} — pending\n{ "status": "pending" }\n\n// GET /v1/diarize/{job_id} — completed\n{\n  "status": "completed",\n  "result": {\n    "segments": [\n      { "speaker": "Speaker A", "start": 0.0, "end": 4.2 },\n      { "speaker": "Speaker B", "start": 4.5, "end": 9.1 }\n    ]\n  }\n}`,
})

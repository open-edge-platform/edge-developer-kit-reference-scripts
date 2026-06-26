// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDocsData } from '@/services/types'

export const getDocsData = ({ host }: { host: string }): ServiceDocsData => ({
  serviceDescription:
    'The OCR service performs optical character recognition on images using PP-OCR detection + recognition pipelines and the PaddleOCR-VL vision-language model, all accelerated with OpenVINO. It returns the recognised text together with per-region bounding boxes and confidence scores. The service is multi-backend by design: a single "ocr" service type can be served by different engines (PaddleOCR today, Tesseract in future) that each live in their own worker directory under workers/ocr.',
  overview:
    'The worker exposes a small REST + WebSocket API. Single-image OCR comes in two flavours: a synchronous call (POST /ocr) that blocks until the result is ready, and an asynchronous submit-and-poll flow (POST /ocr/jobs returns a job id, GET /ocr/jobs/{job_id} polls for the result) that keeps requests short for heavy VL passes. Beyond that, use GET/POST /models to inspect or hot-swap the active model, GET /devices to list OpenVINO accelerators, and the /camera/* + /ocr/stream endpoints for live camera streaming. This Edge AI Studio demo uses the asynchronous flow. Inside Edge AI Studio every endpoint below is also reachable from the browser at the proxied path /api/ocr/<endpoint>.',
  endpoints: [
    {
      method: 'GET',
      path: '/healthcheck',
      description:
        'Liveness/readiness probe. Reports the active model, whether it is loaded, the OpenVINO device, and server-side camera state.',
    },
    {
      method: 'GET',
      path: '/devices',
      description:
        'List the physical OpenVINO accelerators present on the machine (e.g. CPU, GPU, NPU) with their full names.',
    },
    {
      method: 'GET',
      path: '/models',
      description:
        'List every registered model preset along with the currently active model key and device.',
    },
    {
      method: 'GET',
      path: '/models/active',
      description:
        'Return details of the currently active (loaded) model, or { active: null, loaded: false } when none is loaded.',
    },
    {
      method: 'POST',
      path: '/models/load',
      description:
        'Bring up (and switch to) a model from the registry. Loading is serialised so an in-flight load never races an inference.',
      params: [
        {
          name: 'model',
          type: 'string',
          required: true,
          desc: 'Registry key to load, e.g. "ppocrv5", "ppocrv5-server", "ppocrv3", "paddleocr-vl" or "paddleocr-vl-1.5".',
        },
        {
          name: 'device',
          type: 'string',
          required: false,
          desc: 'OpenVINO accelerator override: CPU | GPU | NPU. Defaults to CPU.',
        },
        {
          name: 'options',
          type: 'object',
          required: false,
          desc: 'Per-preset option overrides (custom model URLs, VL repo id, max_new_tokens, quantisation flags, …).',
        },
      ],
    },
    {
      method: 'POST',
      path: '/ocr',
      description:
        'Synchronous OCR. Run OCR on a single uploaded image (multipart/form-data) and block until inference finishes. Returns recognised text, per-region boxes and confidence, region count and inference time. Simplest to call; for heavy VL passes prefer the async POST /ocr/jobs flow.',
      params: [
        {
          name: 'file',
          type: 'file',
          required: true,
          desc: 'The image to recognise, sent as multipart/form-data field "file".',
        },
        {
          name: 'task',
          type: 'string (query)',
          required: false,
          desc: 'VL task selector: ocr | table | formula | chart (default "ocr"). Ignored by PP-OCR models.',
        },
        {
          name: 'drop_score',
          type: 'float (query)',
          required: false,
          desc: 'PP-OCR minimum confidence; regions below this are dropped.',
        },
        {
          name: 'max_new_tokens',
          type: 'int (query)',
          required: false,
          desc: 'Generation cap for VL models.',
        },
      ],
    },
    {
      method: 'POST',
      path: '/ocr/jobs',
      description:
        'Asynchronous OCR — submit. Queue a single uploaded image (multipart/form-data) and return immediately with a job envelope { job_id, status: "pending", result: null, error: null }. Inference runs on a background worker; poll GET /ocr/jobs/{job_id} for the result. Returns 503 if no model is loaded. Accepts the same task/drop_score/max_new_tokens query params as POST /ocr.',
      params: [
        {
          name: 'file',
          type: 'file',
          required: true,
          desc: 'The image to recognise, sent as multipart/form-data field "file".',
        },
        {
          name: 'task',
          type: 'string (query)',
          required: false,
          desc: 'VL task selector: ocr | table | formula | chart (default "ocr"). Ignored by PP-OCR models.',
        },
        {
          name: 'drop_score',
          type: 'float (query)',
          required: false,
          desc: 'PP-OCR minimum confidence; regions below this are dropped.',
        },
        {
          name: 'max_new_tokens',
          type: 'int (query)',
          required: false,
          desc: 'Generation cap for VL models.',
        },
      ],
    },
    {
      method: 'GET',
      path: '/ocr/jobs/{job_id}',
      description:
        'Asynchronous OCR — poll. Return the current state of a job submitted via POST /ocr/jobs as { job_id, status, result, error } where status is pending | running | done | error. When status is "done" the result field holds the same payload as POST /ocr; when "error" the error field holds the message. Unknown or expired job ids return 404. Finished jobs are retained for a few minutes before they age out.',
      params: [
        {
          name: 'job_id',
          type: 'string (path)',
          required: true,
          desc: 'The job id returned by POST /ocr/jobs.',
        },
      ],
    },
    {
      method: 'GET',
      path: '/ocr/stream  (WebSocket)',
      description:
        'WebSocket endpoint: the client pushes raw image bytes (one binary frame per message, e.g. webcam frames) and receives one OCR result JSON per frame. Accepts the same task/drop_score/max_new_tokens query params as POST /ocr.',
    },
    {
      method: 'POST',
      path: '/camera/start',
      description:
        'Start the server-side camera capture loop on the given source.',
      params: [
        {
          name: 'source',
          type: 'string',
          required: false,
          desc: 'Webcam index, file path, or RTSP/HTTP URL. Defaults to the worker camera source.',
        },
      ],
    },
    {
      method: 'POST',
      path: '/camera/stop',
      description: 'Stop the server-side camera capture loop.',
    },
    {
      method: 'GET',
      path: '/camera/status',
      description:
        'Report whether the server-side camera is running and its current source.',
    },
    {
      method: 'GET',
      path: '/camera/stream',
      description:
        'MJPEG stream (multipart/x-mixed-replace) of the server-side camera with OCR annotations drawn on each frame. Auto-starts the camera on the default source if not already running. Accepts task and drop_score query params.',
    },
  ],
  sampleCodeIntro:
    'Single-image OCR is available two ways: synchronous (POST /ocr, blocks for the result) and asynchronous (POST /ocr/jobs then poll GET /ocr/jobs/{job_id}). The first example shows the synchronous call; the second shows the async submit-and-poll flow this demo uses. Examples target the worker through the Edge AI Studio proxy, so the worker root /ocr is reached at /api/ocr/ocr.',
  sampleCode: [
    {
      title: 'Recognise text in an image (synchronous)',
      codeSnippets: [
        {
          language: 'cURL',
          languageCode: 'bash',
          code: `curl -X POST "${host}/ocr?drop_score=0.5" \\
  -F "file=@receipt.jpg"`,
        },
        {
          language: 'Python',
          languageCode: 'python',
          code: `import requests

with open("receipt.jpg", "rb") as f:
    resp = requests.post(
        "${host}/ocr",
        files={"file": f},
        params={"drop_score": 0.5},
    )

result = resp.json()
print(result["full_text"])
for region in result["regions"]:
    print(region["confidence"], region["text"], region["box"])`,
        },
        {
          language: 'JavaScript',
          languageCode: 'javascript',
          code: `const form = new FormData()
form.append('file', fileInput.files[0])

const res = await fetch('${host}/ocr?drop_score=0.5', {
  method: 'POST',
  body: form,
})
const result = await res.json()
console.log(result.full_text)`,
        },
      ],
    },
    {
      title: 'Recognise text in an image (asynchronous, submit + poll)',
      codeSnippets: [
        {
          language: 'cURL',
          languageCode: 'bash',
          code: `# 1. Submit the image -> { "job_id": "...", "status": "pending", ... }
JOB=$(curl -s -X POST "${host}/ocr/jobs?drop_score=0.5" \\
  -F "file=@receipt.jpg" | jq -r .job_id)

# 2. Poll until status is "done" (or "error")
curl -s "${host}/ocr/jobs/$JOB"`,
        },
        {
          language: 'Python',
          languageCode: 'python',
          code: `import time
import requests

with open("receipt.jpg", "rb") as f:
    job = requests.post(
        "${host}/ocr/jobs",
        files={"file": f},
        params={"drop_score": 0.5},
    ).json()

while True:
    status = requests.get(f"${host}/ocr/jobs/{job['job_id']}").json()
    if status["status"] == "done":
        print(status["result"]["full_text"])
        break
    if status["status"] == "error":
        raise RuntimeError(status["error"])
    time.sleep(0.4)`,
        },
        {
          language: 'JavaScript',
          languageCode: 'javascript',
          code: `const form = new FormData()
form.append('file', fileInput.files[0])

const { job_id } = await (
  await fetch('${host}/ocr/jobs?drop_score=0.5', {
    method: 'POST',
    body: form,
  })
).json()

let job
do {
  await new Promise((r) => setTimeout(r, 400))
  job = await (await fetch(\`${host}/ocr/jobs/\${job_id}\`)).json()
} while (job.status === 'pending' || job.status === 'running')

if (job.status === 'error') throw new Error(job.error)
console.log(job.result.full_text)`,
        },
      ],
    },
    {
      title: 'Switch the active model',
      codeSnippets: [
        {
          language: 'cURL',
          languageCode: 'bash',
          code: `# List presets
curl ${host}/models

# Load PaddleOCR-VL on the GPU
curl -X POST ${host}/models/load \\
  -H "Content-Type: application/json" \\
  -d '{"model": "paddleocr-vl", "device": "GPU"}'`,
        },
        {
          language: 'Python',
          languageCode: 'python',
          code: `import requests

requests.post(
    "${host}/models/load",
    json={"model": "ppocrv5-server", "device": "CPU"},
).raise_for_status()`,
        },
      ],
    },
    {
      title: 'Stream webcam frames (WebSocket)',
      codeSnippets: [
        {
          language: 'JavaScript',
          languageCode: 'javascript',
          code: `const wsBase = '${host}'.replace(/^http/, 'ws')
const ws = new WebSocket(\`\${wsBase}/ocr/stream?drop_score=0.5\`)
ws.binaryType = 'arraybuffer'

ws.onmessage = (ev) => {
  const result = JSON.parse(ev.data)
  console.log(result.num_regions, 'regions in', result.elapsed_ms, 'ms')
}

// Send a captured frame (Blob/ArrayBuffer of JPEG/PNG bytes)
canvas.toBlob((blob) => blob.arrayBuffer().then((buf) => ws.send(buf)), 'image/jpeg')`,
        },
      ],
    },
  ],
  responseExample: `{
  "model": "ppocrv5",
  "full_text": "INVOICE\\nTotal: $42.00",
  "regions": [
    {
      "text": "INVOICE",
      "confidence": 0.9971,
      "box": [[34, 18], [212, 18], [212, 64], [34, 64]]
    },
    {
      "text": "Total: $42.00",
      "confidence": 0.9685,
      "box": [[34, 90], [268, 90], [268, 130], [34, 130]]
    }
  ],
  "num_regions": 2,
  "elapsed_ms": 41.7,
  "extra": {}
}`,
})

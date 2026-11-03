// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDocsData } from '@/services/types'

export const getDocsData = ({ host }: { host: string }): ServiceDocsData => ({
  quickStart: {
    steps: [
      'Upload an image to `POST /ocr` as multipart form data (field `file`).',
      "Read the text from `full_text`, and each region's `text`, `box` and `confidence` from `regions`.",
      'On the PaddleOCR-VL models, add `?stream=true` to receive the text as it is generated, or queue the image with `POST /ocr/jobs`.',
    ],
    request: {
      language: 'cURL',
      languageCode: 'bash',
      code: `curl ${host}/ocr -F "file=@receipt.jpg"`,
    },
  },
  serviceDescription:
    'The OCR service performs optical character recognition on images using PP-OCR detection + recognition pipelines and the PaddleOCR-VL vision-language model, all accelerated with OpenVINO. It returns the recognised text together with per-region bounding boxes and confidence scores. Recognition language is selectable per request: detection finds text in any script, while the recogniser is tied to one character dictionary, so the PP-OCR pipelines swap that half to read Latin, Cyrillic, Greek, Arabic, Thai, Korean, Japanese, Chinese and several Indic scripts. The service is multi-backend by design: a single "ocr" service type can be served by different engines (PaddleOCR today, Tesseract in future) that each live in their own worker directory under workers/services/ocr.',
  overview:
    'The worker exposes a small REST + WebSocket API. Single-image OCR comes in two flavours: a synchronous call (POST /ocr) that blocks until the result is ready — or, with ?stream=true, streams the text as Server-Sent Events while the model generates it — and an asynchronous flow (POST /ocr/jobs returns a job id; poll GET /ocr/jobs/{job_id} or follow GET /ocr/jobs/{job_id}/events) that keeps requests short for heavy VL passes (DELETE /ocr/jobs/{job_id} cancels a job nobody wants any more). The PaddleOCR-VL models generate their text token by token, so both the stream and the partial_text of a running job show it as it comes. Beyond that, use GET/POST /models to inspect or hot-swap the active model, GET /languages to list the recognition languages selectable per request, GET /devices to list OpenVINO accelerators, and the /camera/* + /ocr/stream endpoints for live camera streaming. This Edge AI Studio demo submits a job and follows its events, and cancels it when you press Cancel, pick another image or leave the page. Inside Edge AI Studio every endpoint below is also reachable from the browser at the proxied path `/api/ocr@<instance>/<endpoint>`.',
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
      path: '/languages',
      description:
        'List the recognition languages that can be passed as ?lang= on the OCR endpoints, with the active one and a flag saying whether the current model honours the setting. Text detection is script-agnostic, so selecting a language swaps only the recognition half of a PP-OCR pipeline; the recogniser for a language is downloaded and compiled the first time it is used, which makes that one request noticeably slower. The VL models read the script off the page and ignore the setting.',
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
          name: 'lang',
          type: 'string',
          required: false,
          desc: 'Default recognition language for this model (see GET /languages). Individual requests can still override it with ?lang=.',
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
        'Synchronous OCR. Run OCR on a single uploaded image (multipart/form-data) and block until inference finishes. Returns recognised text, per-region boxes and confidence, region count and inference time (also sent as a Server-Timing: inference;dur=<ms> header). With ?stream=true (or an Accept: text/event-stream header) the answer is a Server-Sent Events stream instead: "delta" events { text } as a VL model generates the text (a PP-OCR model sends all of it in one delta), then a "done" event whose data is exactly the JSON body described above (elapsed_ms is the model time), or an "error" event { detail, status }. Deltas add up to the text; take full_text from "done" as authoritative. A bad image or a missing model still answers with a plain HTTP 400/503, and a client that disconnects stops the VL generation. For heavy VL passes the async POST /ocr/jobs flow keeps no request open for the whole pass.',
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
          name: 'lang',
          type: 'string (query)',
          required: false,
          desc: 'Recognition language key from GET /languages (e.g. "en", "korean", "th", "latin", "arabic"). Defaults to the worker\'s configured language. PP-OCR models swap their recogniser to match; the VL models detect the script themselves and ignore it.',
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
        {
          name: 'stream',
          type: 'bool (query)',
          required: false,
          desc: 'Stream the text as Server-Sent Events (delta … done | error) instead of one JSON body. Default false.',
        },
      ],
    },
    {
      method: 'POST',
      path: '/ocr/jobs',
      description:
        'Asynchronous OCR — submit. Queue a single uploaded image (multipart/form-data) and return immediately with a job envelope { job_id, status: "pending", result: null, error: null, partial_text: "" }. Inference runs on a background worker; poll GET /ocr/jobs/{job_id} or follow GET /ocr/jobs/{job_id}/events for the result. Returns 503 if no model is loaded. Accepts the same task/lang/drop_score/max_new_tokens query params as POST /ocr.',
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
          name: 'lang',
          type: 'string (query)',
          required: false,
          desc: 'Recognition language key from GET /languages (e.g. "en", "korean", "th", "latin", "arabic"). Defaults to the worker\'s configured language. PP-OCR models swap their recogniser to match; the VL models detect the script themselves and ignore it.',
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
        'Asynchronous OCR — poll. Return the current state of a job submitted via POST /ocr/jobs as { job_id, status, result, error, partial_text } where status is pending | running | done | error | cancelled. partial_text is the text recognised so far: it grows while a VL model generates it (a PP-OCR model fills it in once, at the end). When status is "done" the result field holds the same payload as POST /ocr and a perf block { seconds, items, started } reports the processing time; when "error" the error field holds the message; a "cancelled" job has neither a result nor a perf block. cancel_requested: true is added once DELETE /ocr/jobs/{job_id} was called. Unknown or expired job ids return 404. Finished jobs are retained for a few minutes before they age out. The job has no deadline: it runs until the model finishes.',
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
      path: '/ocr/jobs/{job_id}/events',
      description:
        'Asynchronous OCR — follow. A Server-Sent Events stream of the job: a "status" event carrying the same envelope as GET /ocr/jobs/{job_id} whenever it changes (so partial_text grows as the text is generated), ending after the "done", "error" or "cancelled" status. Comment lines keep the connection alive while the model works. Following a finished job sends just its final status; unknown or expired job ids return 404. Reconnecting is safe — the job keeps running on the worker either way.',
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
      method: 'DELETE',
      path: '/ocr/jobs/{job_id}',
      description:
        'Asynchronous OCR — cancel. Answers 200 with the job envelope after applying the cancel. A pending job never runs and is "cancelled" at once. A running VL generation stops at its next token, freeing the model for the next job and the camera; a running PP-OCR pass is short and not interrupted, but its result is dropped. Until the pass stops the job keeps its status with cancel_requested: true, then its status (and its events stream) ends with "cancelled". A job that already finished is returned unchanged; unknown or expired job ids return 404.',
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
        'WebSocket endpoint: the client pushes raw image bytes (one binary frame per message, e.g. webcam frames) and receives one OCR result JSON per frame. Accepts the same task/lang/drop_score/max_new_tokens query params as POST /ocr.',
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
        "MJPEG stream (multipart/x-mixed-replace) of the server-side camera with OCR annotations drawn on each frame. One background loop runs OCR on the latest frame for every viewer and each frame is drawn with the latest regions it found, so the video keeps moving while a slow model works; with several viewers, the most recent viewer's options apply. Auto-starts the camera on the default source if not already running. Accepts task, lang and drop_score query params.",
    },
  ],
  sampleCodeIntro:
    "Single-image OCR is available two ways: synchronous (POST /ocr, blocks for the result, or streams the text with ?stream=true) and asynchronous (POST /ocr/jobs, then poll GET /ocr/jobs/{job_id} or follow GET /ocr/jobs/{job_id}/events). The examples show the synchronous call, the streamed text, and the async flow — the demo follows the job's events. Examples target the worker through the Edge AI Studio proxy, so the worker root /ocr is reached at `/api/ocr@<instance>/ocr`.",
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
      title: 'Stream the text as it is generated (VL models)',
      codeSnippets: [
        {
          language: 'cURL',
          languageCode: 'bash',
          code: `# event: delta  data: {"text":"..."}  ...  event: done  data: {<POST /ocr result>}
curl -N -X POST "${host}/ocr?stream=true" \\
  -F "file=@receipt.jpg"`,
        },
        {
          language: 'Python',
          languageCode: 'python',
          code: `import json
import requests

with open("receipt.jpg", "rb") as f:
    resp = requests.post(
        "${host}/ocr",
        files={"file": f},
        params={"stream": "true"},
        stream=True,
    )
resp.raise_for_status()

event = None
for line in resp.iter_lines(decode_unicode=True):
    if line.startswith("event: "):
        event = line[len("event: "):]
    elif line.startswith("data: "):
        data = json.loads(line[len("data: "):])
        if event == "delta":
            print(data["text"], end="", flush=True)
        elif event == "done":
            result = data  # same body as a plain POST /ocr
        elif event == "error":
            raise RuntimeError(data["detail"])`,
        },
        {
          language: 'JavaScript',
          languageCode: 'javascript',
          code: `const form = new FormData()
form.append('file', fileInput.files[0])

const res = await fetch('${host}/ocr?stream=true', { method: 'POST', body: form })
const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
let buffer = ''
let text = ''
for (;;) {
  const { done, value } = await reader.read()
  if (done) break
  buffer += value
  let end
  while ((end = buffer.indexOf('\\n\\n')) >= 0) {
    const block = buffer.slice(0, end)
    buffer = buffer.slice(end + 2)
    const event = /^event: (.*)$/m.exec(block)?.[1]
    const data = /^data: (.*)$/m.exec(block)?.[1]
    if (!event || !data) continue // keep-alive comment
    if (event === 'delta') text += JSON.parse(data).text
    if (event === 'done') text = JSON.parse(data).full_text
    if (event === 'error') throw new Error(JSON.parse(data).detail)
  }
}
console.log(text)`,
        },
      ],
    },
    {
      title: 'Recognise text in an image (asynchronous, submit + follow)',
      codeSnippets: [
        {
          language: 'cURL',
          languageCode: 'bash',
          code: `# 1. Submit the image -> { "job_id": "...", "status": "pending", ... }
JOB=$(curl -s -X POST "${host}/ocr/jobs?drop_score=0.5" \\
  -F "file=@receipt.jpg" | jq -r .job_id)

# 2. Poll until status is "done" (or "error")
curl -s "${host}/ocr/jobs/$JOB"

# ...or follow it: a "status" event each time it changes (partial_text grows)
curl -N "${host}/ocr/jobs/$JOB/events"

# 3. No longer needed? Cancel it (status becomes "cancelled")
curl -s -X DELETE "${host}/ocr/jobs/$JOB"`,
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
    if status["status"] == "cancelled":  # DELETE /ocr/jobs/{job_id}
        break
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
// A job cancelled with DELETE /ocr/jobs/{job_id} ends 'cancelled', no result
if (job.status === 'done') console.log(job.result.full_text)`,
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

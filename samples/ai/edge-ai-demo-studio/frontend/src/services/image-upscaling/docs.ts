// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDocsData } from '@/services/types'

export const getDocsData = ({ host }: { host: string }): ServiceDocsData => ({
  quickStart: {
    steps: [
      'Upload an image to `POST /v1/image-upscaling/image` as multipart form data (field `image`, optional `outscale` and `format`). The answer is a `taskId`.',
      'Poll `GET /v1/tasks/{taskId}` until `status` is `finished`, or follow `GET /v1/tasks/{taskId}/events` as Server-Sent Events.',
      'Download the result from `GET /v1/image-upscaling/image/{taskId}`. It is deleted an hour after the task ends.',
    ],
    request: {
      language: 'cURL',
      languageCode: 'bash',
      code: `TASK_ID=$(curl -s ${host}/v1/image-upscaling/image \\
  -F "image=@photo.jpg" -F "outscale=4" | jq -r .taskId)

# Repeat until "status" is "finished"
curl -s ${host}/v1/tasks/$TASK_ID

curl -s -o upscaled.png ${host}/v1/image-upscaling/image/$TASK_ID`,
    },
  },
  overview:
    "The Image Upscaling service runs super-resolution models on OpenVINO: the Real-ESRGAN family (BSD-3-Clause), SPAN and DAT2 (CC-BY-4.0), AuraSR (CC-BY-SA-4.0) and Swin2SR (Apache-2.0), each converted from its PyTorch checkpoint on first start, and Intel's Open Model Zoo model (Apache-2.0); and SeedVR2 3B (Apache-2.0), a one-step diffusion model, with PyTorch on an Intel GPU (device XPU), for still images of at most 800x600. Images and videos are queued and processed one at a time on a worker thread; a large image is cut into overlapping tiles, so its size is limited only by the 64-megapixel output cap. `POST /v1/image-upscaling/frame` skips the queue and answers with the upscaled frame, for live video.",
  endpoints: [
    {
      method: 'GET',
      path: '/healthcheck',
      description:
        'Readiness: 503 until the model is converted and compiled (SeedVR2: loaded and run once), then the device it runs on (XPU for SeedVR2), the model, its scale and its precision',
    },
    {
      method: 'POST',
      path: '/v1/image-upscaling/image',
      description:
        'Queue an image (multipart). EXIF orientation is applied; transparency is kept, upscaled with Lanczos. The result may hold at most 64 megapixels; SeedVR2 takes inputs of at most 0.48 megapixels (800x600)',
      params: [
        {
          name: 'image',
          type: 'file (binary)',
          required: true,
          desc: 'Source image (PNG, JPEG, WebP, BMP, TIFF, ...)',
        },
        {
          name: 'outscale',
          type: 'number',
          required: false,
          desc: "Output size as a multiple of the input, 1 to the model's scale; below it, the model's output is resized down with Lanczos (default: the model's scale)",
        },
        {
          name: 'format',
          type: 'string',
          required: false,
          desc: "'png' (default), 'webp' or 'jpeg'",
        },
      ],
    },
    {
      method: 'POST',
      path: '/v1/image-upscaling/video',
      description:
        'Queue a video (multipart): every frame upscaled, the frame rate and audio kept, encoded as H.264 MP4. Frames may come out at most 3840x2160. Not with SeedVR2 (400)',
      params: [
        {
          name: 'video',
          type: 'file (binary)',
          required: true,
          desc: 'Source video file',
        },
        {
          name: 'outscale',
          type: 'number',
          required: false,
          desc: "As for images (default: the model's scale)",
        },
      ],
    },
    {
      method: 'POST',
      path: '/v1/image-upscaling/frame',
      description:
        "Upscale one image sent as the request body and answer with it, outside the queue (it waits while the running job finishes its current image or video frame). The response carries Server-Timing (model time) and X-Image-Width / X-Image-Height. Query: outscale, format (default 'jpeg'). At most 3840x2160 out. Not with SeedVR2 (400)",
    },
    {
      method: 'GET',
      path: '/v1/tasks/{taskId}',
      description:
        'Poll a task (status: queued | running | finished | error | cancelled | not_found). Queued: the queue position. Running: progress 0-1, with tiles_done / tiles_total for an image (stage, the phase it is in, for SeedVR2) or frames_done / frames_total for a video. Finished: the input and output sizes, megapixels, and for a video frames and fps',
    },
    {
      method: 'DELETE',
      path: '/v1/tasks/{taskId}',
      description:
        'Cancel a task and return its status: a queued task is cancelled at once; a running one reports cancel_requested: true until its next tile or frame, then is cancelled and its partial output deleted',
    },
    {
      method: 'GET',
      path: '/v1/tasks/{taskId}/events',
      description:
        'Follow a task as Server-Sent Events (text/event-stream): a "status" event with the same body as GET /v1/tasks/{taskId} whenever it changes, ending after the final one',
    },
    {
      method: 'GET',
      path: '/v1/image-upscaling/image/{taskId}',
      description:
        'Download a finished image task. Results are deleted an hour after the task ends',
    },
    {
      method: 'GET',
      path: '/v1/image-upscaling/video/{taskId}',
      description:
        'Download a finished video task (MP4). Results are deleted an hour after the task ends',
    },
  ],
  sampleCode: [
    {
      title: 'Upscale an image 4x',
      codeSnippets: [
        {
          language: 'Python',
          languageCode: 'python',
          code: `import time
import requests

with open("photo.jpg", "rb") as f:
    task = requests.post(
        "${host}/v1/image-upscaling/image",
        files={"image": f},
        data={"outscale": 4, "format": "png"},
    ).json()

while True:
    status = requests.get("${host}/v1/tasks/" + task["taskId"]).json()
    if status["status"] in ("finished", "error", "cancelled", "not_found"):
        break
    time.sleep(0.5)

if status["status"] == "finished":
    image = requests.get("${host}/v1/image-upscaling/image/" + task["taskId"])
    with open("upscaled.png", "wb") as f:
        f.write(image.content)`,
        },
      ],
    },
    {
      title: 'Upscale frames live',
      codeSnippets: [
        {
          language: 'Python',
          languageCode: 'python',
          code: `import requests

with open("frame.jpg", "rb") as f:
    response = requests.post(
        "${host}/v1/image-upscaling/frame",
        params={"outscale": 4, "format": "jpeg"},
        data=f.read(),
    )
print(response.headers["Server-Timing"])  # inference;dur=<ms>
with open("frame_x4.jpg", "wb") as f:
    f.write(response.content)`,
        },
      ],
    },
  ],
  responseExample: `{
  "taskId": "1a2b3c4d"
}`,
})

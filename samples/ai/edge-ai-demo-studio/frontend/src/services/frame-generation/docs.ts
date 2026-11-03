// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDocsData } from '@/services/types'

export const getDocsData = ({ host }: { host: string }): ServiceDocsData => ({
  quickStart: {
    steps: [
      'Upload a video to `POST /v1/frame-generation/video` as multipart form data (field `video`, with a `multiplier` of 2 to 4). The answer is a `taskId`.',
      'Poll `GET /v1/tasks/{taskId}` until `status` is `finished`, or follow `GET /v1/tasks/{taskId}/events` as Server-Sent Events.',
      'Download the result from `GET /v1/frame-generation/video/{taskId}`. It is deleted an hour after the task ends.',
    ],
    request: {
      language: 'cURL',
      languageCode: 'bash',
      code: `TASK_ID=$(curl -s ${host}/v1/frame-generation/video \\
  -F "video=@input.mp4" -F "multiplier=2" | jq -r .taskId)

# Repeat until "status" is "finished"
curl -s ${host}/v1/tasks/$TASK_ID

curl -s -o output.mp4 ${host}/v1/frame-generation/video/$TASK_ID`,
    },
  },
  overview:
    'The Frame Generation service interpolates video frames with the RIFE model on OpenVINO. It fills the frames between keyframe pairs (used by the Lipsync service to reach the avatar frame rate on slower accelerators) and upscales the frame rate of uploaded videos by an integer multiplier.',
  endpoints: [
    {
      method: 'POST',
      path: '/v1/frame-generation/interpolate',
      description:
        'Fill the frames between keyframe pairs. Body is an uncompressed .npz (application/octet-stream) with frames_a [N,H,W,3] uint8, frames_b [N,H,W,3] uint8 and counts [N] int; the response is an .npz with arrays gap_0..gap_{N-1}.',
    },
    {
      method: 'POST',
      path: '/v1/frame-generation/benchmark',
      description:
        'Measure interpolation throughput (frames/sec) for a gap schedule; also warms lazily-compiled shapes for that schedule',
      params: [
        {
          name: 'image_size',
          type: 'number',
          required: false,
          desc: 'Square frame size to benchmark with (default: 256)',
        },
        {
          name: 'gap_sizes',
          type: 'number[]',
          required: false,
          desc: 'Frames to generate per gap, e.g. [1, 1, 1] (default: [1])',
        },
        {
          name: 'rounds',
          type: 'number',
          required: false,
          desc: 'Timed repetitions; the median is reported (default: 3)',
        },
      ],
    },
    {
      method: 'POST',
      path: '/v1/frame-generation/video',
      description:
        'Queue a video interpolation job (FPS upscaling or slow motion); jobs run one at a time on a worker thread and the returned task id is polled (or followed as events) for progress',
      params: [
        {
          name: 'video',
          type: 'file (binary)',
          required: true,
          desc: 'Source video file',
        },
        {
          name: 'multiplier',
          type: 'number',
          required: false,
          desc: 'Frame multiplier, 2-4 (default: 2)',
        },
        {
          name: 'mode',
          type: 'string',
          required: false,
          desc: "'fps' multiplies the frame rate keeping the duration (audio kept); 'slowmo' keeps the frame rate and stretches the duration (audio dropped). Default: 'fps'",
        },
      ],
    },
    {
      method: 'GET',
      path: '/v1/tasks/{taskId}',
      description:
        'Poll a video interpolation task (status: queued | running | finished | error | cancelled | not_found; queued responses include the queue position, running ones progress 0-1, frames_done / frames_total output frames and cancel_requested once a cancel was asked for)',
    },
    {
      method: 'DELETE',
      path: '/v1/tasks/{taskId}',
      description:
        'Cancel a video interpolation task and return its status: a queued task is cancelled at once; a running one reports cancel_requested: true until its next chunk of frames, then is cancelled and its partial video deleted; a task that already ended is returned unchanged',
    },
    {
      method: 'GET',
      path: '/v1/tasks/{taskId}/events',
      description:
        'Follow a video interpolation task as Server-Sent Events (text/event-stream): a "status" event carrying the same body as GET /v1/tasks/{taskId} whenever it changes, ending after the finished, error, cancelled or not_found status',
    },
    {
      method: 'GET',
      path: '/v1/frame-generation/video/{taskId}',
      description:
        'Download the interpolated video of a finished task. Results are deleted an hour after the task ends',
    },
  ],
  sampleCode: [
    {
      title: 'Upscale a video to 2x FPS',
      codeSnippets: [
        {
          language: 'Python',
          languageCode: 'python',
          code: `import time
import requests

with open("input.mp4", "rb") as f:
    task = requests.post(
        "${host}/v1/frame-generation/video",
        files={"video": f},
        data={"multiplier": 2},
    ).json()

while True:
    status = requests.get("${host}/v1/tasks/" + task["taskId"]).json()
    if status["status"] in ("finished", "error", "cancelled", "not_found"):
        break
    time.sleep(1)

if status["status"] == "finished":
    video = requests.get(
        "${host}/v1/frame-generation/video/" + task["taskId"]
    )
    with open("output.mp4", "wb") as f:
        f.write(video.content)`,
        },
      ],
    },
    {
      title: 'Benchmark interpolation throughput',
      codeSnippets: [
        {
          language: 'Python',
          languageCode: 'python',
          code: `import requests

response = requests.post(
    "${host}/v1/frame-generation/benchmark",
    json={"image_size": 256, "gap_sizes": [1, 1, 1]},
)
print(response.json())  # {"fps": ..., "seconds_per_frame": ...}`,
        },
      ],
    },
  ],
  responseExample: `{
  "taskId": "1a2b3c4d"
}`,
})

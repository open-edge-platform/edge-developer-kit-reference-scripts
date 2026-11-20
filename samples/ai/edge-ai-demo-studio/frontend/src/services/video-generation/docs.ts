// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { DocsFactoryOptions, ServiceDocsData } from '@/services/types'
import { DEFAULT_VIDEO_MODEL } from './config'

export const getDocsData = ({
  host,
  model,
}: DocsFactoryOptions): ServiceDocsData => {
  const id = model || DEFAULT_VIDEO_MODEL
  const a14b = id.includes('A14B')
  // Wan2.2 A14B makes Wan2.1's shapes: its VAE, 81 frames at 16 fps.
  const wan21 = id.includes('Wan2.1') || a14b
  const vace = id.includes('VACE')
  const size = wan21 ? '832x480' : '1280x704'
  const defaultSize = a14b ? '1280x720' : size
  const textRequest = `curl ${host}/v1/videos \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${id}",
    "prompt": "A paper boat drifting down a rainy street, cinematic",
    "size": "${size}",
    "seconds": "2"
  }'`
  const poseRequest = `curl ${host}/v1/videos \\
  -F prompt="A robot in silver armour dancing on a rooftop at sunset" \\
  -F size=${size} \\
  -F seconds=3 \\
  -F input_video=@dance.mp4 \\
  -F input_reference=@robot.png`

  return {
    quickStart: {
      steps: [
        vace
          ? 'Send a video of someone moving (`input_video`) to `POST /v1/videos`, optionally an image of who should move (`input_reference`) and a prompt: it answers at once with the queued video and its `id`.'
          : 'Start a video with `POST /v1/videos`: it answers at once with the queued video and its `id`.',
        'Follow it with `GET /v1/videos/{id}` (or the `/events` stream) until `status` is `completed`.',
        'Download the MP4 from `GET /v1/videos/{id}/content`.',
      ],
      request: {
        language: 'cURL',
        languageCode: 'bash',
        code: vace ? poseRequest : textRequest,
      },
    },
    overview: `The Video Generation service makes short videos from a text prompt, or from a start image and a prompt (Wan2.2 TI2V models), or following the poses of a driving video (Wan2.1 VACE, which draws them with DWPose and can take an image of the subject), with the Wan family of video diffusion transformers. It follows OpenAI's Videos API: the paths, request fields and Video object match, so an OpenAI SDK pointed at this base URL works unchanged (\`client.videos.create\`, \`retrieve\`, \`download_content\`, \`list\`, \`delete\`), and extra fields (frames, steps, guidance, seed) go in the same request. A video is a background job: an instance makes one at a time, first come first served, and keeps a finished video for an hour. The instance runs one model, on OpenVINO (any OpenVINO device; the transformer and text encoder at the precision chosen in Configure) or with PyTorch on an Intel GPU (XPU). A new size or length is compiled for on first use on OpenVINO, which the status reports as the \`prepare\` phase.`,
    endpoints: [
      {
        method: 'POST',
        path: '/v1/videos',
        description:
          'Start a video. JSON or multipart/form-data (needed for an image). Answers with the queued Video object',
        params: [
          {
            name: 'prompt',
            type: 'string',
            required: true,
            desc: 'What the video shows: subject, motion, camera, light. Optional with `input_video` or `pose_video` (VACE), where the poses and the subject image lead',
          },
          {
            name: 'model',
            type: 'string',
            required: false,
            desc: `The instance's model (\`${id}\`); any other is rejected`,
          },
          {
            name: 'size',
            type: 'string',
            required: false,
            desc: vace
              ? `Width x height, multiples of 16, up to 1280x720 in either orientation (default ${defaultSize}). Above 480p the video is denoised in overlapping windows of fewer frames, which takes longer`
              : `Width x height, multiples of ${wan21 ? 16 : 32}, at most the model's trained size in either orientation (default ${defaultSize})`,
          },
          {
            name: 'seconds',
            type: 'string',
            required: false,
            desc: vace
              ? 'Length in seconds; up to 30 at 16 fps, past 5 made in overlapping windows (time grows with each). Ignored when `num_frames` is set'
              : `Length in seconds; up to ${wan21 ? '5 at 16' : '5 at 24'} fps. Ignored when \`num_frames\` is set`,
          },
          {
            name: 'num_frames',
            type: 'integer',
            required: false,
            desc: `Frame count, rounded to 4k + 1 (5 to ${vace ? 481 : wan21 ? 81 : 121})`,
          },
          {
            name: 'input_reference',
            type: 'file',
            required: false,
            desc: 'Wan2.2 TI2V: the start image (multipart file or a data: URL), cropped to the size keeping its centre. VACE: the subject to show (a full-body picture works best), fitted inside the frame. Not taken by Wan2.1 T2V or Wan2.2 T2V A14B',
          },
          {
            name: 'input_video',
            type: 'file',
            required: false,
            desc: 'VACE only, multipart: a video of someone moving. The poses of everyone in it are drawn (status phase `pose`) at the model frame rate, fitted inside the size on black (never cropped: send a size of the same orientation as the video to fill the frame), and the result follows them; a video shorter than asked makes a shorter result',
          },
          {
            name: 'pose_video',
            type: 'file',
            required: false,
            desc: 'VACE only, multipart: pose maps drawn already (OpenPose style on black, e.g. an earlier `content?variant=control`), used as they are instead of `input_video`',
          },
          {
            name: 'control_scale',
            type: 'number',
            required: false,
            desc: 'VACE only: how strongly the poses steer the video, 0-2 (default 1, as trained)',
          },
          {
            name: 'negative_prompt',
            type: 'string',
            required: false,
            desc: "What to avoid; Wan's recommended negative prompt when omitted",
          },
          {
            name: 'num_inference_steps',
            type: 'integer',
            required: false,
            desc: 'Denoising steps (1-100). FastWan always runs its 3 distilled steps',
          },
          {
            name: 'guidance_scale',
            type: 'number',
            required: false,
            desc: 'Classifier-free guidance, 1-20 (1 turns it off and halves the time). Not used by FastWan',
          },
          {
            name: 'guidance_scale_2',
            type: 'number',
            required: false,
            desc: 'Wan2.2 A14B only: the guidance of its low-noise transformer, which takes over for the last steps, 1-20 (default 3; `guidance_scale` is the high-noise one, default 4)',
          },
          {
            name: 'fps',
            type: 'integer',
            required: false,
            desc: `Frame rate of the MP4 (default ${wan21 ? 16 : 24}); the model's own is best`,
          },
          {
            name: 'seed',
            type: 'integer',
            required: false,
            desc: 'Random seed: the same seed and settings give the same video on the same backend',
          },
          {
            name: 'preview',
            type: 'boolean',
            required: false,
            desc: "Also make a small MP4 (at most 640 px on its long side) of the model's guess at the finished video after each denoising step but the last, as it goes: `previews` in the status counts them, `content?variant=preview&step=n` serves them. Costs one pass of the tiny decoder per step (a few percent on a GPU)",
          },
        ],
      },
      {
        method: 'GET',
        path: '/v1/videos/{id}',
        description:
          "A video's status: OpenAI's Video object (`status`, `progress` 0-100, `error`) plus `phase` (pose, prepare, text, denoise, decode, encode), `step`/`steps`, `position` in the queue, `elapsed_time` and `estimated_time` in seconds, and with `preview` the `previews` made so far (steps 1 to `previews`)",
      },
      {
        method: 'GET',
        path: '/v1/videos/{id}/events',
        description:
          'The same status as Server-Sent Events (`status` events) whenever it changes, ending with the final one',
      },
      {
        method: 'GET',
        path: '/v1/videos/{id}/content',
        description:
          'The finished video as H.264 MP4; `?variant=thumbnail` gives a WebP still from its middle, `?variant=control` the pose video a VACE video followed (readable once drawn), `?variant=preview&step=n` the preview of step n of a video asked with `preview` (readable once made, before the video is done; the latest without `step`)',
      },
      {
        method: 'DELETE',
        path: '/v1/videos/{id}',
        description:
          'Deletes a finished video; a queued or running one is cancelled instead (its status reads `cancelled`)',
      },
      {
        method: 'GET',
        path: '/v1/videos',
        description:
          'The videos this instance keeps, newest first (`limit`, `after`, `order`)',
      },
      {
        method: 'GET',
        path: '/v1/videos/capabilities',
        description:
          'What the instance runs: model, backend, device, precision, decoder, whether it takes a start image, sizes, defaults and limits',
      },
    ],
    errors: {
      intro:
        'A rejected request answers with OpenAI\'s error shape: `{ "error": { "message", "type" } }`. A video that fails while generating reports `status: "failed"` and `error.message` instead.',
      cases: [
        {
          status: 400,
          when: 'A missing prompt, another model, a size or length out of range, or an image for a text-only model',
        },
        {
          status: 404,
          when: 'An unknown video, or one deleted or kept past its hour',
        },
        { status: 409, when: 'The content of a video that is not completed' },
        { status: 503, when: 'The model is still loading' },
      ],
    },
    sampleCodeIntro:
      "The OpenAI Python SDK works against the instance as it is; fields beyond OpenAI's go in `extra_body`.",
    sampleCode: [
      {
        title: 'Text to video with the OpenAI SDK',
        codeSnippets: [
          {
            language: 'Python',
            languageCode: 'python',
            code: `import time
from openai import OpenAI

client = OpenAI(base_url="${host}/v1", api_key="unused")
video = client.videos.create(
    model="${id}",
    prompt="A red fox trotting through fresh snow at sunrise",
    size="${size}",
    seconds="2",
    extra_body={"seed": 42},
)
while video.status in ("queued", "in_progress"):
    time.sleep(2)
    video = client.videos.retrieve(video.id)
    print(video.status, video.progress, "%")

if video.status == "completed":
    client.videos.download_content(video.id).write_to_file("video.mp4")
else:
    print(video.error)`,
          },
        ],
      },
      {
        title: 'Image to video (Wan2.2 TI2V)',
        codeSnippets: [
          {
            language: 'cURL',
            languageCode: 'bash',
            code: `curl ${host}/v1/videos \\
  -F prompt="The cat turns its head and blinks at the camera" \\
  -F size=1280x704 \\
  -F seconds=3 \\
  -F input_reference=@cat.jpg`,
          },
        ],
      },
    ],
    responseExample: `{
  "id": "video_3f2c…",
  "object": "video",
  "model": "${id}",
  "status": "in_progress",
  "progress": 47,
  "size": "${size}",
  "seconds": "2",
  "phase": "denoise",
  "step": 10,
  "steps": 20,
  "num_frames": ${wan21 ? 33 : 49},
  "fps": ${wan21 ? 16 : 24},
  "elapsed_time": 31.4,
  "estimated_time": 28.1
}`,
  }
}

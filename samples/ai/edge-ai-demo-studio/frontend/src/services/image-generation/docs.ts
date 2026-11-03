// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDocsData } from '@/services/types'

export const getDocsData = ({
  host,
  model,
}: {
  host: string
  model?: string
}): ServiceDocsData => {
  const genModel =
    (model && model.includes(':')
      ? model.slice(model.indexOf(':') + 1)
      : model) || 'OpenVINO/stable-diffusion-v1-5-int8-ov'

  return {
    quickStart: {
      steps: [
        `Send a prompt to \`POST /v1/images/generations\` with the model \`${genModel}\`.`,
        'The image comes back base64-encoded in `data[0].b64_json`; decode it into a PNG file.',
        'An instance makes one image at a time. For longer runs, add `"is_polling": true` and follow the job with `GET /v1/images/jobs/{job_id}/events`.',
      ],
      request: {
        language: 'cURL',
        languageCode: 'bash',
        code: `curl ${host}/v1/images/generations \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${genModel}",
    "prompt": "A lighthouse at dusk, watercolor",
    "num_inference_steps": 20
  }' | jq -r '.data[0].b64_json' | base64 -d > image.png`,
      },
    },
    overview:
      "The Image Generation service creates images from text prompts using Stable Diffusion models accelerated with OpenVINO. It supports text-to-image generation and image-to-image editing through OpenAI-compatible endpoints backed by OpenVINO Model Server (OVMS): the paths, request fields and response shape match OpenAI's Images API, so an OpenAI SDK pointed at this base URL works unchanged. The same routes are also served under the legacy `/v3` prefix for backwards compatibility. An instance makes one image at a time: requests from every client wait in one queue, first come first served, and a request answered at once waits its turn like a background job.",
    endpoints: [
      {
        method: 'POST',
        path: '/v1/images/generations',
        description: 'Generate images from a text prompt',
        params: [
          {
            name: 'model',
            type: 'string',
            required: true,
            desc: 'Name of the model to use for generation (e.g., OpenVINO/stable-diffusion-v1-5-int8-ov)',
          },
          {
            name: 'prompt',
            type: 'string',
            required: true,
            desc: 'A text description of the desired image(s)',
          },
          {
            name: 'size',
            type: 'string',
            required: false,
            desc: 'Image size in WxH format (default: 512x512). Use "auto" for model default.',
          },
          {
            name: 'n',
            type: 'integer',
            required: false,
            desc: 'Number of images to generate. Uses batch computation for better performance. (default: 1, max: 10)',
          },
          {
            name: 'prompt_2',
            type: 'string',
            required: false,
            desc: 'Second prompt for models with multiple text encoders (SDXL/SD3/FLUX)',
          },
          {
            name: 'prompt_3',
            type: 'string',
            required: false,
            desc: 'Third prompt for models with three text encoders (SD3)',
          },
          {
            name: 'negative_prompt',
            type: 'string',
            required: false,
            desc: 'Negative prompt for models that support it (SD/SDXL/SD3)',
          },
          {
            name: 'negative_prompt_2',
            type: 'string',
            required: false,
            desc: 'Second negative prompt (SDXL/SD3)',
          },
          {
            name: 'negative_prompt_3',
            type: 'string',
            required: false,
            desc: 'Third negative prompt (SD3)',
          },
          {
            name: 'num_inference_steps',
            type: 'integer',
            required: false,
            desc: 'Number of denoising steps. Higher values increase quality and generation time. (default: 50, range: 1-200)',
          },
          {
            name: 'guidance_scale',
            type: 'number',
            required: false,
            desc: 'Controls how closely the model follows the prompt. Higher values produce more prompt-aligned but less natural results. (default: 7.5, range: 0.0-20.0)',
          },
          {
            name: 'rng_seed',
            type: 'integer',
            required: false,
            desc: 'Random seed for reproducibility',
          },
          {
            name: 'max_sequence_length',
            type: 'integer',
            required: false,
            desc: 'Max sequence length for T5 encoder (SD3/FLUX). Lower values improve performance.',
          },
          {
            name: 'response_format',
            type: 'string',
            required: false,
            desc: "`b64_json` answers the image data; `url` answers where each image is served (`/api/<type>@<instance>/v1/images/jobs/{job_id}/images/{index}`, relative to the app), kept as long as a finished job. Also applies to a background job's `/result`. (default: b64_json)",
          },
          {
            name: 'is_polling',
            type: 'boolean',
            required: false,
            desc: 'Run as a background job: answers at once with `{ job_id }`, and the images are made one at a time (a set `rng_seed` moves on by one per image). Follow the job with `GET /v1/images/jobs/{job_id}/events`; cancel it with `DELETE /v1/images/jobs/{job_id}`. (default: false)',
          },
        ],
      },
      {
        method: 'POST',
        path: '/v1/images/edits',
        description:
          'Edit an existing image with a text prompt (multipart/form-data)',
        params: [
          {
            name: 'model',
            type: 'string',
            required: true,
            desc: 'Name of the model to use for editing',
          },
          {
            name: 'image',
            type: 'file',
            required: true,
            desc: 'The image file to edit (multipart upload)',
          },
          {
            name: 'prompt',
            type: 'string',
            required: true,
            desc: 'A text description of the desired edits',
          },
          {
            name: 'size',
            type: 'string',
            required: false,
            desc: 'Output image size in WxH format (default: 512x512)',
          },
          {
            name: 'n',
            type: 'integer',
            required: false,
            desc: 'Number of edited images to generate (default: 1)',
          },
          {
            name: 'strength',
            type: 'number',
            required: false,
            desc: 'How much to transform the source image. 0.0 keeps original, 1.0 fully replaces it. (default: 0.75)',
          },
          {
            name: 'negative_prompt',
            type: 'string',
            required: false,
            desc: 'Negative prompt for models that support it (SD/SDXL/SD3)',
          },
          {
            name: 'num_inference_steps',
            type: 'integer',
            required: false,
            desc: 'Number of denoising steps (default: 50)',
          },
          {
            name: 'guidance_scale',
            type: 'number',
            required: false,
            desc: 'Guidance scale for classifier-free guidance (default: 7.5)',
          },
          {
            name: 'rng_seed',
            type: 'integer',
            required: false,
            desc: 'Random seed for reproducibility',
          },
          {
            name: 'response_format',
            type: 'string',
            required: false,
            desc: '`b64_json` or `url`, as for generations (default: b64_json)',
          },
          {
            name: 'is_polling',
            type: 'boolean',
            required: false,
            desc: 'Run as a background job: answers at once with `{ job_id }`, and the images are made one at a time (a set `rng_seed` moves on by one per image). Follow the job with `GET /v1/images/jobs/{job_id}/events`; cancel it with `DELETE /v1/images/jobs/{job_id}`. (default: false)',
          },
        ],
      },
      {
        method: 'GET',
        path: '/v1/images/jobs/{job_id}/events',
        description:
          'Follow a background job as Server-Sent Events: a `status` event whenever it changes, ending with the final one (`completed`, `failed` or `cancelled`). A status is `{ id, type, status: "pending" | "in_progress" | "completed" | "failed" | "cancelled", n, images_done, elapsed_time, estimated_time, error? }`. While `pending` it waits in the queue at `position` (1 is next); `in_progress` adds `cancel_requested` once a cancel was asked for. `estimated_time` is the seconds the job should run, from the time images take on this instance; while unfinished, `seconds_per_image` is the time one image should take, and a running job has `started` and `image_started` (epoch seconds), so `elapsed_time - (image_started - started)` is how far the image in progress is. A completed job carries `perf`. Read the images from `/images/{index}` or `/result`.',
        params: [
          {
            name: 'job_id',
            type: 'string',
            required: true,
            desc: 'The `job_id` a request with `is_polling` answered with (path parameter)',
          },
        ],
      },
      {
        method: 'GET',
        path: '/v1/images/jobs/{job_id}/result',
        description:
          'The images a job has finished so far, in the images response shape (`{ created, data: [{ b64_json }] }`, or `[{ url }]` for a request with `response_format: "url"`). Finished jobs stay readable for 30 minutes (at most the 16 most recent), and until the worker restarts.',
        params: [
          {
            name: 'job_id',
            type: 'string',
            required: true,
            desc: 'Job ID (path parameter)',
          },
          {
            name: 'offset',
            type: 'integer',
            required: false,
            desc: 'Skip the first `offset` images, to read only the ones finished since the last read (default: 0)',
          },
        ],
      },
      {
        method: 'GET',
        path: '/v1/images/jobs/{job_id}/images/{index}',
        description:
          'One finished image of a job, as PNG. Images do not change once made, so they can be cached.',
        params: [
          {
            name: 'job_id',
            type: 'string',
            required: true,
            desc: 'Job ID (path parameter)',
          },
          {
            name: 'index',
            type: 'integer',
            required: true,
            desc: 'Image index, from 0 up to `images_done - 1` (path parameter)',
          },
        ],
      },
      {
        method: 'GET',
        path: '/v1/images/jobs/{job_id}',
        description:
          'Poll a background job: its status, with the images finished so far in `result` (or the error message of a failed job).',
        params: [
          {
            name: 'job_id',
            type: 'string',
            required: true,
            desc: 'Job ID (path parameter)',
          },
        ],
      },
      {
        method: 'DELETE',
        path: '/v1/images/jobs/{job_id}',
        description:
          'Cancel a background job and answer with its status, as `GET` does. A job still `pending` becomes `cancelled` at once; a running one keeps `in_progress` with `cancel_requested: true` until its image in progress is done (a call to the model server cannot be interrupted), then becomes `cancelled`, and the images it made stay readable; a finished job is left as it is. `cancelled` is final and carries no `perf`.',
        params: [
          {
            name: 'job_id',
            type: 'string',
            required: true,
            desc: 'Job ID (path parameter)',
          },
        ],
      },
      {
        method: 'GET',
        path: '/v1/images/tasks/{task_type}',
        description:
          'Get the status of the most recent background job of a type, in the same shape as `GET /v1/images/jobs/{job_id}`. Task types: "image-generation" or "image-edit".',
        params: [
          {
            name: 'task_type',
            type: 'string',
            required: true,
            desc: 'Type of task to check: "image-generation" or "image-edit" (path parameter)',
          },
        ],
      },
      {
        method: 'GET',
        path: '/v1/models',
        description:
          'List the model this worker serves, in the OpenAI models shape (`{ object: "list", data: [{ id, object, created, owned_by }] }`). `GET /v1/models/{id}` retrieves one.',
      },
      {
        method: 'GET',
        path: '/v1/config',
        description: 'Get OVMS server configuration and loaded models',
      },
      {
        method: 'GET',
        path: '/healthcheck',
        description: 'Check service health status',
      },
    ],
    sampleCode: [
      {
        title: 'Generate images',
        codeSnippets: [
          {
            language: 'Python',
            languageCode: 'python',
            code: `from openai import OpenAI
import base64
from io import BytesIO
from PIL import Image

client = OpenAI(
    base_url="${host}/v1",
    api_key="unused"
)

response = client.images.generate(
    model="${genModel}",
    prompt="Three astronauts on the moon, cold color palette, muted colors, detailed, 8k",
    size="512x512",
    n=1,
    extra_body={
        "rng_seed": 409,
        "num_inference_steps": 50,
        "guidance_scale": 7.5
    }
)

base64_image = response.data[0].b64_json
image_data = base64.b64decode(base64_image)
image = Image.open(BytesIO(image_data))
image.save("generate_output.png")`,
          },
          {
            language: 'cURL',
            languageCode: 'bash',
            code: `curl -X POST ${host}/v1/images/generations \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${genModel}",
    "prompt": "Three astronauts on the moon, cold color palette, muted colors, detailed, 8k",
    "size": "512x512",
    "n": 1,
    "num_inference_steps": 50,
    "rng_seed": 409
  }'`,
          },
        ],
      },
      {
        title: 'Edit images',
        codeSnippets: [
          {
            language: 'Python',
            languageCode: 'python',
            code: `from openai import OpenAI
import base64
from io import BytesIO
from PIL import Image

client = OpenAI(
    base_url="${host}/v1",
    api_key="unused"
)

response = client.images.edit(
    model="${genModel}",
    image=open("generate_output.png", "rb"),
    prompt="Three astronauts in the jungle, vibrant color palette, detailed, 8k",
    extra_body={
        "rng_seed": 409,
        "size": "512x512",
        "num_inference_steps": 50,
        "strength": 0.67
    }
)

base64_image = response.data[0].b64_json
image_data = base64.b64decode(base64_image)
image = Image.open(BytesIO(image_data))
image.save("edit_output.png")`,
          },
          {
            language: 'cURL',
            languageCode: 'bash',
            code: `curl -X POST ${host}/v1/images/edits \\
  -F "model=${genModel}" \\
  -F "image=@generate_output.png" \\
  -F "prompt=Three astronauts in the jungle, vibrant color palette, detailed, 8k" \\
  -F "rng_seed=409" \\
  -F "size=512x512" \\
  -F "num_inference_steps=50" \\
  -F "strength=0.67"`,
          },
        ],
      },
      {
        title: 'Run as a background job',
        codeSnippets: [
          {
            language: 'cURL',
            languageCode: 'bash',
            code: `# Start the job: answers at once with its job_id
JOB_ID=$(curl -s -X POST ${host}/v1/images/generations \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${genModel}",
    "prompt": "Three astronauts on the moon, cold color palette, muted colors, detailed, 8k",
    "n": 2,
    "is_polling": true
  }' | jq -r .job_id)

# Follow its status (queue position, then progress) until it is completed,
# failed or cancelled
curl -N ${host}/v1/images/jobs/$JOB_ID/events

# Save the images as PNG
curl -s -o image-0.png ${host}/v1/images/jobs/$JOB_ID/images/0
curl -s -o image-1.png ${host}/v1/images/jobs/$JOB_ID/images/1

# Or read them in the images response shape
curl -s ${host}/v1/images/jobs/$JOB_ID/result

# Cancel it: dropped at once while queued, else stops before its next image
curl -s -X DELETE ${host}/v1/images/jobs/$JOB_ID`,
          },
        ],
      },
    ],
    responseExample: `{
  "created": 1234567890,
  "data": [
    {
      "b64_json": "<base64-encoded-image>"
    }
  ]
}`,
  }
}

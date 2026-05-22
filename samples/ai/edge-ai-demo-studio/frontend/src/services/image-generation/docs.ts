// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDocsData } from '@/services/types'

export const getDocsData = ({ host }: { host: string }): ServiceDocsData => ({
  overview:
    'The Image Generation service creates images from text prompts using Stable Diffusion models accelerated with OpenVINO. It supports text-to-image generation and image-to-image editing via OpenAI-compatible API endpoints backed by OpenVINO Model Server (OVMS).',
  endpoints: [
    {
      method: 'POST',
      path: '/v1/image-generation/v3/images/generations',
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
      ],
    },
    {
      method: 'POST',
      path: '/v1/image-generation/v3/images/edits',
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
      ],
    },
    {
      method: 'GET',
      path: '/v1/image-generation/v3/images/tasks/{task_type}',
      description:
        'Get the status of a long-running generation or edit task. Task types: "image-generation" or "image-edit".',
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
      path: '/v1/image-generation/v1/config',
      description: 'Get OVMS server configuration and loaded models',
    },
    {
      method: 'GET',
      path: '/v1/image-generation/healthcheck',
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
    base_url="${host}/v3",
    api_key="unused"
)

response = client.images.generate(
    model="OpenVINO/stable-diffusion-v1-5-int8-ov",
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
          code: `curl -X POST ${host}/v3/images/generations \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "OpenVINO/stable-diffusion-v1-5-int8-ov",
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
    base_url="${host}/v3",
    api_key="unused"
)

response = client.images.edit(
    model="OpenVINO/stable-diffusion-v1-5-int8-ov",
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
          code: `curl -X POST ${host}/v3/images/edits \\
  -F "model=OpenVINO/stable-diffusion-v1-5-int8-ov" \\
  -F "image=@generate_output.png" \\
  -F "prompt=Three astronauts in the jungle, vibrant color palette, detailed, 8k" \\
  -F "rng_seed=409" \\
  -F "size=512x512" \\
  -F "num_inference_steps=50" \\
  -F "strength=0.67"`,
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
})

// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import CodeBlock from '@/components/common/codeblock'
import { CodeSnippet } from '@/types/code'

export default function ImageGenerationDocumentation({
  url,
  model,
}: {
  url: string
  model: string
}) {
  const generateImagesSnippet: CodeSnippet[] = [
    {
      language: 'Python',
      languageCode: 'py',
      code: `from openai import OpenAI
import base64
from io import BytesIO
from PIL import Image

client = OpenAI(
    base_url="${url}/v3",
    api_key="unused"
)

response = client.images.generate(
    model="${model}",
    prompt="Three astronauts on the moon, cold color palette, muted colors, detailed, 8k",
    extra_body={
        "rng_seed": 409,
        "size": "512x512",
        "num_inference_steps": 50
    }
)

base64_image = response.data[0].b64_json
image_data = base64.b64decode(base64_image)
image = Image.open(BytesIO(image_data))
image.save('generate_output.png')`,
    },
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `import OpenAI from "openai";
import fs from "fs";

const openai = new OpenAI({
  baseURL: '${url}/v3',
  apiKey: 'unused',
});

const response = await openai.images.generate({
  model: "${model}",
  prompt: "Three astronauts on the moon, cold color palette, muted colors, detailed, 8k",
  rng_seed: 409,
  size: "512x512",
  num_inference_steps: 50
});

const base64Image = response.data[0].b64_json;
const buffer = Buffer.from(base64Image, 'base64');
await fs.promises.writeFile("generate_output.png", buffer);`,
    },
  ]

  const editImagesSnippet: CodeSnippet[] = [
    {
      language: 'Python',
      languageCode: 'py',
      code: `from openai import OpenAI
import base64
from io import BytesIO
from PIL import Image

client = OpenAI(
    base_url="${url}/v3",
    api_key="unused"
)

response = client.images.edit(
    model="${model}",
    image=open("generate_output.png", "rb"),
    prompt="Three astronauts in the jungle, vibrant color palette, live colors, detailed, 8k",
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
image.save('edit_output.png')`,
    },
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `import OpenAI, { toFile } from "openai";
import fs from "fs";

const openai = new OpenAI({
  baseURL: '${url}/v3',
  apiKey: 'unused',
});

const image = await toFile(fs.createReadStream("generate_output.png"), null, {
    type: "image/png",
})

const response = await openai.images.edit({
  model: "${model}",
  image: image,
  prompt: "Three astronauts in the jungle, vibrant color palette, live colors, detailed, 8k",
  rng_seed: 409,
  size: "512x512",
  num_inference_steps: 50,
  strength: 0.67
});

const base64Image = response.data[0].b64_json;
const buffer = Buffer.from(base64Image, 'base64');
await fs.promises.writeFile("edit_output.png", buffer);`,
    },
  ]

  const readinessCheckSnippet: CodeSnippet[] = [
    {
      language: 'Python',
      languageCode: 'py',
      code: `import requests

response = requests.get(f"${url}/v1/config")
print(response.json())`,
    },
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `const url = '${url}/v1/config'
fetch(url)
  .then(res => res.json())
  .then(data => console.log(data))`,
    },
  ]

  return (
    <div className="grid gap-8 lg:grid-cols-4">
      <div className="lg:col-span-4">
        <div className="space-y-8">
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-slate-900">
                  Image Generation API
                </h1>
              </div>
            </div>
          </div>

          <div id="overview" className="prose flex max-w-none flex-col gap-4">
            <p className="leading-relaxed text-slate-700">
              This image generation service leverages{' '}
              <a
                className="text-primary font-medium"
                target="_blank"
                href="https://github.com/openvinotoolkit/model_server"
              >
                OpenVINO Model Server
              </a>{' '}
              to provide efficient and scalable image generation with
              OpenAI-compatible endpoints. You can generate images from text
              prompts and edit existing images using advanced diffusion models
              optimized for Intel hardware. The service exposes two main
              endpoints:{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
                images/generations
              </code>{' '}
              for text-to-image generation and{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
                images/edits
              </code>{' '}
              for image-to-image editing.
            </p>

            <p className="leading-relaxed text-slate-700">
              Before making any requests, check if the service is ready:
            </p>
            <CodeBlock
              title="Check service readiness"
              data={readinessCheckSnippet}
            />

            <p className="leading-relaxed text-slate-700">
              Here&apos;s how to generate images with the{' '}
              <a
                className="text-primary font-medium"
                target="_blank"
                href="https://platform.openai.com/docs/guides/images-vision?api-mode=responses"
              >
                OpenAI library
              </a>
              :
            </p>
            <CodeBlock
              title="Generate images from text prompts"
              data={generateImagesSnippet}
            />

            <p className="leading-relaxed text-slate-700">
              You can also edit existing images by providing an image file and a
              new prompt:
            </p>
            <CodeBlock title="Edit existing images" data={editImagesSnippet} />

            <p className="leading-relaxed text-slate-700">
              Please refer to the&nbsp;
              <span className="text-primary font-medium">Endpoints</span> tab
              for a list of available parameters.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

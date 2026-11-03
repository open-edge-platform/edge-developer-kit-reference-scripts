// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { DocsFactoryOptions, ServiceDocsData } from '@/services/types'
import { DEFAULT_OEP_EMBEDDING_MODEL, isOepEmbeddingModel } from './config'

/** The engines whose APIs differ, as the Runtime Settings tabs name them. */
const BACKENDS = [
  { id: 'multiserve', label: 'Multiserve engine' },
  { id: 'oep', label: 'OEP engine' },
]

export const getDocsData = ({
  host,
  model,
  metadata,
}: DocsFactoryOptions): ServiceDocsData => {
  const inferModel = model || 'openvino:OpenVINO/Qwen3-Embedding-0.6B-int8-ov'
  const oep = isOepEmbeddingModel(inferModel)
  const servedModel = oep
    ? inferModel
    : inferModel.includes(':')
      ? inferModel.slice(inferModel.indexOf(':') + 1)
      : inferModel

  // Listed whichever engine runs, marked as the OEP engine's own.
  const oepEndpoints: NonNullable<ServiceDocsData['endpoints']> = [
    {
      method: 'POST',
      path: '/embeddings',
      backends: ['oep'],
      description:
        "The Open Edge Platform microservice's native endpoint: one typed input (text, image_url, image_base64, video_frames, video_url, video_base64) and a bare vector in the response. Use it for the video input types, which the OpenAI-compatible endpoint does not expose.",
      params: [
        {
          name: 'model',
          type: 'string',
          required: true,
          desc: `Must match the loaded model (e.g. "${DEFAULT_OEP_EMBEDDING_MODEL}").`,
        },
        {
          name: 'input',
          type: 'object',
          required: true,
          desc: 'Typed input, e.g. {"type": "text", "text": "..."} or {"type": "image_base64", "image_base64": "..."}.',
        },
      ],
    },
    {
      method: 'GET',
      path: '/model/capabilities',
      backends: ['oep'],
      description:
        'Modalities the loaded model supports (text, image, video). CLIP and SigLIP models embed text and images into the same space; the QwenText models are text-only.',
    },
  ]

  return {
    quickStart: {
      steps: [
        `Send text to \`POST /v1/embeddings\` with the model \`${inferModel}\`.`,
        'Each input comes back as one vector in `data[i].embedding`, in the order sent. Compare vectors by cosine similarity.',
        oep
          ? 'CLIP and SigLIP models embed images too: add items such as `{"type": "image_url", "image_url": "https://…"}` to `input`.'
          : `To call it from code, point an OpenAI client at \`${host}/v1\` with any API key.`,
      ],
      request: {
        language: 'cURL',
        languageCode: 'bash',
        code: `curl ${host}/v1/embeddings \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${inferModel}", "input": ["Edge AI computing", "Cloud inference"]}'`,
      },
    },
    backends: BACKENDS,
    // Only an instance has an engine; without one both are described.
    activeBackend: metadata ? (oep ? 'oep' : 'multiserve') : undefined,
    serviceDescription: oep
      ? 'The Text Embedding service is running the Open Edge Platform multimodal-embedding-serving microservice natively. CLIP and SigLIP models embed text and images into one shared vector space on OpenVINO, so an image can be searched with text and vice versa; the QwenText models provide OpenVINO Qwen3 text embeddings. The service keeps an OpenAI-compatible embeddings endpoint, extended with typed image inputs, so existing OpenAI client code keeps working without an internet connection.'
      : 'The Text Embedding service leverages the OpenVINO Model Server to generate high-quality dense vector representations of text for semantic search, retrieval-augmented generation (RAG), and document clustering. It exposes an OpenAI-compatible embeddings endpoint, enabling seamless use with existing OpenAI client libraries such as the Python openai package or the Node.js openai library — without requiring an internet connection.',
    overview: oep
      ? 'The OpenAI-compatible endpoint accepts a string, a list of strings, or a list mixing strings with typed image items ({"type": "image_base64", ...} or {"type": "image_url", ...}). Every item comes back as one vector in the same space, so cosine similarity between an image vector and text vectors gives zero-shot classification. Switch the engine under Advanced settings in the Configure sheet to run text-only models on multiserve instead.'
      : 'The service exposes an OpenAI-compatible embeddings endpoint for generating dense vector representations of text. It supports single and batch input with configurable encoding format. Use the OpenAI client libraries by pointing the base URL to the service. Switch the engine under Advanced settings in the Configure sheet to the Open Edge Platform multimodal worker to embed images as well.',
    endpoints: [
      {
        method: 'POST',
        path: '/v1/embeddings',
        description: oep
          ? 'Generate embeddings for text and image inputs in the OpenAI request/response shape. Returns dense vectors suitable for semantic search, similarity comparison, and zero-shot image classification.'
          : 'Generate embeddings for one or more text inputs. Returns dense vectors suitable for semantic search, similarity comparison, and clustering.',
        params: [
          {
            name: 'model',
            type: 'string',
            required: true,
            desc: oep
              ? `The loaded Open Edge Platform model id (e.g. "${DEFAULT_OEP_EMBEDDING_MODEL}"). Run GET /v1/models to read it; another value is accepted and answered with the loaded model.`
              : 'Model identifier in <provider>:<model_id> format, where provider is "openvino" or "llamacpp" (e.g. "openvino:OpenVINO/Qwen3-Embedding-0.6B-int8-ov"). Run GET /v1/models to list the available identifiers.',
          },
          {
            name: 'input',
            type: oep
              ? 'string | (string | {type: "image_base64", image_base64} | {type: "image_url", image_url})[]'
              : 'string | string[]',
            required: true,
            desc: oep
              ? 'Text to embed, or a list of texts and typed image items. image_base64 accepts a data: URL or raw base64; image_url must be a public http(s) URL. Image items are rejected with 400 when the loaded model is text-only.'
              : 'Input text to embed, encoded as a string or a list of strings.',
          },
          {
            name: 'encoding_format',
            type: 'string',
            required: false,
            desc: 'The format to return the embeddings in. Supported values: "float" (default) or "base64".',
          },
        ],
      },
      {
        method: 'GET',
        path: '/v1/models',
        description: oep
          ? 'List the loaded model in the OpenAI models shape. `GET /v1/models/{id}` retrieves one — model ids contain a slash (e.g. "CLIP/clip-vit-b-16") and are matched in full.'
          : 'List the models the engine can serve, in the OpenAI models shape. `GET /v1/models/{id}` retrieves one.',
      },
      ...oepEndpoints,
    ],
    sampleCodeIntro:
      'The service is fully compatible with the OpenAI Python and Node.js client libraries. Use base_url pointing to the service and set api_key to any non-empty string.',
    sampleCode: [
      {
        title: 'Embeddings',
        codeSnippets: [
          {
            language: 'Python',
            languageCode: 'python',
            code: `from openai import OpenAI

client = OpenAI(base_url="${host}/v1", api_key="unused")
model = "${inferModel}"

response = client.embeddings.create(
    model=model,
    input=[
        "Edge AI computing",
        "Cloud-based inference",
        "Intel OpenVINO toolkit"
    ],
)
for item in response.data:
    print(f"Index {item.index}: {len(item.embedding)} dimensions")`,
          },
          {
            language: 'JavaScript',
            languageCode: 'javascript',
            code: `import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: '${host}/v1',
  apiKey: 'unused',
})
const model = '${inferModel}'

const response = await client.embeddings.create({
  model,
  input: [
    'Edge AI computing',
    'Cloud-based inference',
    'Intel OpenVINO toolkit',
  ],
})

for (const item of response.data) {
  console.log(\`Index \${item.index}: \${item.embedding.length} dimensions\`)
}`,
          },
          {
            language: 'cURL',
            languageCode: 'bash',
            code: `curl ${host}/v1/embeddings \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${inferModel}",
    "input": ["Edge AI computing", "Cloud-based inference"],
    "encoding_format": "float"
  }'`,
          },
        ],
      },
      ...(oep
        ? [
            {
              title: 'Image embeddings (zero-shot matching)',
              codeSnippets: [
                {
                  language: 'Python',
                  languageCode: 'python',
                  code: `import base64
import numpy as np
import requests

with open("photo.jpg", "rb") as fh:
    image_b64 = base64.b64encode(fh.read()).decode()

labels = ["a photo of a cat", "a photo of a dog", "a city street"]
response = requests.post(
    "${host}/v1/embeddings",
    json={
        "model": "${inferModel}",
        "input": [{"type": "image_base64", "image_base64": image_b64}, *labels],
    },
)
vectors = [np.array(item["embedding"]) for item in response.json()["data"]]
image, texts = vectors[0], vectors[1:]
scores = [float(image @ t / (np.linalg.norm(image) * np.linalg.norm(t))) for t in texts]
for label, score in sorted(zip(labels, scores), key=lambda x: -x[1]):
    print(f"{score:.3f}  {label}")`,
                },
                {
                  language: 'cURL',
                  languageCode: 'bash',
                  code: `curl ${host}/v1/embeddings \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${inferModel}",
    "input": [
      {"type": "image_url", "image_url": "https://example.com/photo.jpg"},
      "a photo of a cat",
      "a photo of a dog"
    ]
  }'`,
                },
              ],
            },
          ]
        : []),
    ],
    responseExample: `{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "embedding": [
        -0.03440694510936737,
        -0.02553200162947178,
        -0.010130723007023335,
        0.02722850814461708,
        -0.017527244985103607
      ],
      "index": 0
    }
  ],
  "model": "${servedModel}",
  "usage": {
    "prompt_tokens": 6,
    "total_tokens": 6
  }
}`,
  }
}

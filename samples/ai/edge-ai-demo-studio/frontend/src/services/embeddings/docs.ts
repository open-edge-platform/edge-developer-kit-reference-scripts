// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDocsData } from '@/services/types'

export const getDocsData = ({ host }: { host: string }): ServiceDocsData => ({
  serviceDescription:
    'The Text Embedding service leverages the OpenVINO Model Server to generate high-quality dense vector representations of text for semantic search, retrieval-augmented generation (RAG), and document clustering. It exposes an OpenAI-compatible embeddings endpoint, enabling seamless use with existing OpenAI client libraries such as the Python openai package or the Node.js openai library — without requiring an internet connection.',
  overview:
    'The service exposes an OpenAI-compatible embeddings endpoint for generating dense vector representations of text. It supports single and batch input with configurable encoding format. Use the OpenAI client libraries by pointing the base URL to the service.',
  endpoints: [
    {
      method: 'POST',
      path: '/v1/embeddings',
      description:
        'Generate embeddings for one or more text inputs. Returns dense vectors suitable for semantic search, similarity comparison, and clustering.',
      params: [
        {
          name: 'model',
          type: 'string',
          required: true,
          desc: 'Name of the model to use. Name assigned to a MediaPipe graph configured to schedule generation using the desired embedding model.',
        },
        {
          name: 'input',
          type: 'string | string[]',
          required: true,
          desc: 'Input text to embed, encoded as a string or a list of strings.',
        },
        {
          name: 'encoding_format',
          type: 'string',
          required: false,
          desc: 'The format to return the embeddings in. Supported values: "float" (default) or "base64".',
        },
      ],
    },
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

client = OpenAI(base_url="${host}/embeddings/v1", api_key="unused")
model = "embeddings"

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
  baseURL: '${host}/embeddings/v1',
  apiKey: 'unused',
})
const model = 'embeddings'

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
          code: `curl ${host}/embeddings/v1/embeddings \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "embeddings",
    "input": ["Edge AI computing", "Cloud-based inference"],
    "encoding_format": "float"
  }'`,
        },
      ],
    },
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
  "model": "embeddings",
  "usage": {
    "prompt_tokens": 6,
    "total_tokens": 6
  }
}`,
})

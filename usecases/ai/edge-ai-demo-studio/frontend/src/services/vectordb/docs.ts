// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDocsData } from '@/services/types'

export const getDocsData = ({ host }: { host: string }): ServiceDocsData => ({
  serviceDescription:
    'The Vector Database service provides FAISS-based vector storage for knowledge base management, document ingestion, and semantic search. It supports both text-based embedding (via external services) and direct pre-computed vector storage for maximum flexibility.',
  overview:
    'RESTful API for managing knowledge bases with vector storage. Supports CRUD operations on knowledge bases, document file upload and chunking, text chunk management, similarity search by query text or raw embedding vectors, and runtime configuration of external embedding/reranker services.',
  endpoints: [
    {
      method: 'POST',
      path: '/v1/configure',
      description:
        'Configure external embedding and reranker service URLs. Must be called before using text-based embedding operations.',
      params: [
        {
          name: 'embedding_url',
          type: 'string',
          required: true,
          desc: 'Base URL of the external embedding service',
        },
        {
          name: 'embedding_model',
          type: 'string',
          required: true,
          desc: 'Model name to use for embeddings',
        },
        {
          name: 'reranker_url',
          type: 'string',
          required: false,
          desc: 'Base URL of the external reranker service',
        },
        {
          name: 'reranker_model',
          type: 'string',
          required: false,
          desc: 'Model name for reranking',
        },
      ],
    },
    {
      method: 'GET',
      path: '/v1/kb',
      description: 'List all knowledge bases.',
    },
    {
      method: 'POST',
      path: '/v1/kb',
      description: 'Create a new knowledge base.',
      params: [
        {
          name: 'name',
          type: 'string',
          required: true,
          desc: 'Name of the knowledge base',
        },
      ],
    },
    {
      method: 'DELETE',
      path: '/v1/kb/{id}',
      description: 'Delete a knowledge base and all its data.',
      params: [
        {
          name: 'id',
          type: 'integer',
          required: true,
          desc: 'Knowledge base ID',
        },
      ],
    },
    {
      method: 'POST',
      path: '/v1/kb/{id}/chunks',
      description:
        'Add a text chunk to the knowledge base (requires embedding service configured).',
      params: [
        {
          name: 'content',
          type: 'string',
          required: true,
          desc: 'Text content of the chunk',
        },
        {
          name: 'metadata',
          type: 'object',
          required: false,
          desc: 'Optional metadata for the chunk',
        },
      ],
    },
    {
      method: 'POST',
      path: '/v1/kb/{id}/vectors',
      description:
        'Add pre-computed embedding vectors directly. Does not require an embedding service.',
      params: [
        {
          name: 'vectors',
          type: 'array',
          required: true,
          desc: 'Array of {embedding: number[], content: string, metadata?: object}',
        },
      ],
    },
    {
      method: 'POST',
      path: '/v1/kb/{id}/search',
      description:
        'Search by text query (requires embedding service configured).',
      params: [
        {
          name: 'query',
          type: 'string',
          required: true,
          desc: 'Search query string',
        },
        {
          name: 'top_k',
          type: 'integer',
          required: false,
          desc: 'Number of results to retrieve (default: 4)',
        },
        {
          name: 'top_n',
          type: 'integer',
          required: false,
          desc: 'Number of results after reranking (default: 3)',
        },
      ],
    },
    {
      method: 'POST',
      path: '/v1/kb/{id}/search/vector',
      description:
        'Search by a pre-computed embedding vector. Does not require an embedding service.',
      params: [
        {
          name: 'embedding',
          type: 'number[]',
          required: true,
          desc: 'Pre-computed query embedding vector',
        },
        {
          name: 'top_k',
          type: 'integer',
          required: false,
          desc: 'Number of results to return (default: 4)',
        },
      ],
    },
  ],
  sampleCode: [
    {
      title: 'Sample code',
      codeSnippets: [
        {
          language: 'Python',
          languageCode: 'python',
          code: `import requests

# 1. Create a knowledge base
kb = requests.post(
    "${host}/api/vectordb/v1/kb",
    json={"name": "My Documents"}
).json()

# 2. Add text chunks (requires embedding service configured)
requests.post(
    f"${host}/api/vectordb/v1/kb/{kb['id']}/chunks",
    json={"content": "Intel OpenVINO accelerates AI inference on edge devices."}
)

# 3. Search
results = requests.post(
    f"${host}/api/vectordb/v1/kb/{kb['id']}/search",
    json={"query": "edge AI inference", "top_k": 5}
).json()

for doc in results:
    print(doc["content"])`,
        },
        {
          language: 'cURL',
          languageCode: 'bash',
          code: `# Create a knowledge base
curl -X POST ${host}/api/vectordb/v1/kb \\
  -H "Content-Type: application/json" \\
  -d '{"name": "My Documents"}'

# Add pre-computed vectors (no embedding service needed)
curl -X POST ${host}/api/vectordb/v1/kb/1/vectors \\
  -H "Content-Type: application/json" \\
  -d '{"vectors": [{"embedding": [0.1, 0.2, ...], "content": "sample text"}]}'

# Search by vector
curl -X POST ${host}/api/vectordb/v1/kb/1/search/vector \\
  -H "Content-Type: application/json" \\
  -d '{"embedding": [0.1, 0.2, ...], "top_k": 5}'`,
        },
      ],
    },
  ],
  responseExample: `// POST /v1/kb/{id}/search
[
  {
    "content": "Intel OpenVINO accelerates AI inference on edge devices.",
    "metadata": { "source": "manual_chunk" }
  },
  {
    "content": "Edge computing brings processing closer to data sources.",
    "metadata": { "source": "document.pdf" }
  }
]`,
})

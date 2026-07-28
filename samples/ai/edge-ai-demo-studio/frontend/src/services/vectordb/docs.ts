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
        'Configure external embedding and reranker service URLs. Must be called before using text-based embedding operations (create embeddings, add text chunks, text search).',
      params: [
        {
          name: 'embedding_url',
          type: 'string',
          required: true,
          desc: 'Base URL of the external embedding service (e.g. http://localhost:8001/v1)',
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
      path: '/v1/config',
      description:
        'Get the current embedding/reranker configuration currently in effect.',
    },

    // ── Knowledge bases ─────────────────────────────────────
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
      method: 'GET',
      path: '/v1/kb/{id}',
      description: 'Get a single knowledge base by ID.',
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
      method: 'DELETE',
      path: '/v1/kb/{id}',
      description:
        'Delete a knowledge base and all its data (uploaded files and vector store). Returns the updated list of knowledge bases.',
      params: [
        {
          name: 'id',
          type: 'integer',
          required: true,
          desc: 'Knowledge base ID',
        },
      ],
    },

    // ── Documents (file upload) ─────────────────────────────
    {
      method: 'GET',
      path: '/v1/kb/{id}/files',
      description: 'List the document files uploaded to a knowledge base.',
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
      path: '/v1/kb/{id}/files',
      description:
        'Upload a document file to the knowledge base (multipart/form-data). Accepts .pdf, .docx, .html, .txt, .csv, and .json. Files are stored until embeddings are generated.',
      params: [
        {
          name: 'file',
          type: 'file',
          required: true,
          desc: 'The document to upload (multipart form field "file")',
        },
      ],
    },
    {
      method: 'DELETE',
      path: '/v1/kb/{id}/files',
      description: 'Delete a previously uploaded file from the knowledge base.',
      params: [
        {
          name: 'name',
          type: 'string',
          required: true,
          desc: 'Filename to delete (e.g. "document.pdf")',
        },
      ],
    },

    // ── Embedding generation ────────────────────────────────
    {
      method: 'POST',
      path: '/v1/kb/{id}/create',
      description:
        'Chunk and embed all uploaded documents in the knowledge base into the FAISS vector store (requires embedding service configured).',
      params: [
        {
          name: 'splitter_name',
          type: 'string',
          required: false,
          desc: "Text splitter: 'Character', 'RecursiveCharacter' (default), or 'Markdown'",
        },
        {
          name: 'chunk_size',
          type: 'integer',
          required: false,
          desc: 'Size of each text chunk (default: 512)',
        },
        {
          name: 'chunk_overlap',
          type: 'integer',
          required: false,
          desc: 'Overlap between chunks; must be less than chunk_size (default: 200)',
        },
      ],
    },
    {
      method: 'POST',
      path: '/v1/kb/{id}/files/embed',
      description:
        'Chunk and embed a single uploaded file into the vector store (requires embedding service configured).',
      params: [
        {
          name: 'filename',
          type: 'string',
          required: true,
          desc: 'Name of the uploaded file to embed',
        },
        {
          name: 'splitter_name',
          type: 'string',
          required: false,
          desc: "Text splitter: 'Character', 'RecursiveCharacter' (default), or 'Markdown'",
        },
        {
          name: 'chunk_size',
          type: 'integer',
          required: false,
          desc: 'Size of each text chunk (default: 512)',
        },
        {
          name: 'chunk_overlap',
          type: 'integer',
          required: false,
          desc: 'Overlap between chunks; must be less than chunk_size (default: 200)',
        },
      ],
    },

    // ── Chunks ──────────────────────────────────────────────
    {
      method: 'GET',
      path: '/v1/kb/{id}/chunks',
      description:
        'Retrieve all chunks stored in the knowledge base. Returns { kb_id, total_chunks, chunks }.',
      params: [
        {
          name: 'include_embeddings',
          type: 'boolean',
          required: false,
          desc: 'Include the raw embedding vectors in the response (default: false)',
        },
      ],
    },
    {
      method: 'POST',
      path: '/v1/kb/{id}/chunks',
      description:
        'Add a single text chunk to the knowledge base (requires embedding service configured).',
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
      method: 'DELETE',
      path: '/v1/kb/{id}/chunks',
      description: 'Delete chunks from the knowledge base by document IDs.',
      params: [
        {
          name: 'doc_ids',
          type: 'string[]',
          required: true,
          desc: 'List of document IDs to delete',
        },
      ],
    },
    {
      method: 'DELETE',
      path: '/v1/kb/{id}/chunks/source',
      description:
        'Delete all chunks that originate from a given source (e.g. a filename or "manual_chunk").',
      params: [
        {
          name: 'source',
          type: 'string',
          required: true,
          desc: 'Filename (e.g. "document.pdf") or special identifier (e.g. "manual_chunk")',
        },
      ],
    },

    // ── Vectors (pre-computed) ──────────────────────────────
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

    // ── Search ──────────────────────────────────────────────
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
          name: 'search_type',
          type: 'string',
          required: false,
          desc: "'similarity' (default), 'mmr', or 'similarity_score_threshold'",
        },
        {
          name: 'top_k',
          type: 'integer',
          required: false,
          desc: 'Number of documents to retrieve from vector search (default: 4)',
        },
        {
          name: 'top_n',
          type: 'integer',
          required: false,
          desc: 'Number of documents to return after reranking (default: 3)',
        },
        {
          name: 'score_threshold',
          type: 'number',
          required: false,
          desc: 'Minimum relevance threshold (only for similarity_score_threshold)',
        },
        {
          name: 'fetch_k',
          type: 'integer',
          required: false,
          desc: 'Documents passed to the MMR algorithm (only for mmr, default: 20)',
        },
        {
          name: 'lambda_mult',
          type: 'number',
          required: false,
          desc: 'MMR diversity, 1=min diversity, 0=max diversity (only for mmr, default: 0.5)',
        },
        {
          name: 'filter',
          type: 'object',
          required: false,
          desc: 'Filter results by document metadata',
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
        {
          name: 'filter',
          type: 'object',
          required: false,
          desc: 'Filter results by document metadata',
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

# 1. Point the worker at an embedding (and optional reranker) service
requests.post(
    "${host}/v1/configure",
    json={
        "embedding_url": "http://localhost:8001/v1",
        "embedding_model": "BAAI/bge-small-en-v1.5",
    },
)

# 2. Create a knowledge base
kb = requests.post(
    "${host}/v1/kb",
    json={"name": "My Documents"}
).json()

# 3. Upload a document file (.pdf, .docx, .html, .txt, .csv, .json)
with open("handbook.pdf", "rb") as f:
    requests.post(
        f"${host}/v1/kb/{kb['id']}/files",
        files={"file": ("handbook.pdf", f, "application/pdf")},
    )

# 4. Chunk + embed the uploaded documents into the vector store
requests.post(
    f"${host}/v1/kb/{kb['id']}/create",
    json={"chunk_size": 512, "chunk_overlap": 200},
)

# 5. Search
results = requests.post(
    f"${host}/v1/kb/{kb['id']}/search",
    json={"query": "edge AI inference", "top_k": 5}
).json()

for doc in results:
    print(doc["content"])`,
        },
        {
          language: 'cURL',
          languageCode: 'bash',
          code: `# Create a knowledge base
curl -X POST ${host}/v1/kb \\
  -H "Content-Type: application/json" \\
  -d '{"name": "My Documents"}'

# Upload a document file (multipart/form-data)
curl -X POST ${host}/v1/kb/1/files \\
  -F "file=@handbook.pdf"

# Generate embeddings for the uploaded documents
curl -X POST ${host}/v1/kb/1/create \\
  -H "Content-Type: application/json" \\
  -d '{"chunk_size": 512, "chunk_overlap": 200}'

# Add pre-computed vectors (no embedding service needed)
curl -X POST ${host}/v1/kb/1/vectors \\
  -H "Content-Type: application/json" \\
  -d '{"vectors": [{"embedding": [0.1, 0.2, ...], "content": "sample text"}]}'

# Search by vector
curl -X POST ${host}/v1/kb/1/search/vector \\
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

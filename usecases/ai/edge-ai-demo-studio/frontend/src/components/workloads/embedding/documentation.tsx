// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import React from 'react'
import CodeBlock from '@/components/common/codeblock'

export default function EmbeddingDocumentation({
  port,
  model,
}: {
  port: number
  model: string
}) {
  const embeddingsAPISnippet = [
    {
      language: 'Python',
      languageCode: 'py' as const,
      code: `from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:${port}/v1",
    api_key="unused"
)

response = client.embeddings.create(
    input="The quick brown fox jumps over the lazy dog",
    model="${model}",
    encoding_format="float"
)

print("Embedding vector:", response.data[0].embedding[:5])  # First 5 dimensions
print("Vector length:", len(response.data[0].embedding))`,
    },
    {
      language: 'JavaScript',
      languageCode: 'js' as const,
      code: `import OpenAI from 'openai'

const client = new OpenAI({
    baseURL: 'http://localhost:${port}/v1',
    apiKey: 'unused',
})

const response = await client.embeddings.create({
    input: 'The quick brown fox jumps over the lazy dog',
    model: '${model}',
    encoding_format: 'float'
})

console.log('Embedding vector:', response.data[0].embedding.slice(0, 5))  // First 5 dimensions
console.log('Vector length:', response.data[0].embedding.length)`,
    },
  ]

  const knowledgeBaseSnippet = [
    {
      language: 'Python',
      languageCode: 'py' as const,
      code: `import requests

# Create a knowledge base
kb_data = {"name": "My Knowledge Base", "db": ""}
response = requests.post("http://localhost:${port}/v1/kb", json=kb_data)
kb = response.json()
print("Created KB:", kb)

kb_id = kb["id"]

# Upload a document to the knowledge base
with open("document.pdf", "rb") as f:
    files = {"file": ("document.pdf", f, "application/pdf")}
    response = requests.post(f"http://localhost:${port}/v1/kb/{kb_id}/files", files=files)
    print("Upload result:", response.json())

# Create embeddings with default settings
response = requests.post(f"http://localhost:${port}/v1/kb/{kb_id}/create")
print("Embeddings result:", response.json())

# Or create embeddings with advanced configuration
embedding_config = {
    "splitter_name": "RecursiveCharacter",  # 'Character', 'RecursiveCharacter', or 'Markdown'
    "chunk_size": 1000,
    "chunk_overlap": 200
}
response = requests.post(f"http://localhost:${port}/v1/kb/{kb_id}/create", json=embedding_config)
print("Advanced embeddings result:", response.json())`,
    },
    {
      language: 'JavaScript',
      languageCode: 'js' as const,
      code: `import fs from 'fs'
import fetch from 'node-fetch'

// Create a knowledge base
const kbData = { name: "My Knowledge Base", db: "" }
let response = await fetch('http://localhost:${port}/v1/kb', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(kbData)
})
const kb = await response.json()
console.log('Created KB:', kb)

const kbId = kb.id

// Upload a document to the knowledge base
const fileBuffer = fs.readFileSync('document.pdf')
const formData = new FormData()
formData.append('file', new Blob([fileBuffer], { type: 'application/pdf' }), 'document.pdf')

response = await fetch(\`http://localhost:${port}/v1/kb/\${kbId}/files\`, {
  method: 'POST',
  body: formData
})
const uploadResult = await response.json()
console.log('Upload result:', uploadResult)

// Create embeddings with default settings
response = await fetch(\`http://localhost:${port}/v1/kb/\${kbId}/create\`, {
  method: 'POST'
})
let embeddingsResult = await response.json()
console.log('Embeddings result:', embeddingsResult)

// Or create embeddings with advanced configuration
const embeddingConfig = {
  splitter_name: 'RecursiveCharacter', // 'Character', 'RecursiveCharacter', or 'Markdown'
  chunk_size: 1000,
  chunk_overlap: 200
}
response = await fetch(\`http://localhost:${port}/v1/kb/\${kbId}/create\`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(embeddingConfig)
})
embeddingsResult = await response.json()
console.log('Advanced embeddings result:', embeddingsResult)`,
    },
  ]

  const knowledgeBaseManagementSnippet = [
    {
      language: 'Python',
      languageCode: 'py' as const,
      code: `import requests

# Get all knowledge bases
response = requests.get("http://localhost:${port}/v1/kb")
knowledge_bases = response.json()
print("Knowledge Bases:", knowledge_bases)

# Get specific knowledge base
kb_id = 1
response = requests.get(f"http://localhost:${port}/v1/kb/{kb_id}")
kb_details = response.json()
print("KB Details:", kb_details)

# Get files in a knowledge base
response = requests.get(f"http://localhost:${port}/v1/kb/{kb_id}/files")
files = response.json()
print("Files:", files)

# Delete a file from knowledge base
file_data = {"name": "document.pdf"}
response = requests.delete(f"http://localhost:${port}/v1/kb/{kb_id}/files", json=file_data)
print("Delete file result:", response.json())

# Search in knowledge base with basic query
search_data = {"query": "your search query"}
response = requests.post(f"http://localhost:${port}/v1/kb/{kb_id}/search", json=search_data)

results = response.json()
print("Search results:", results)

# Advanced search with parameters
advanced_search = {
    "query": "your search query",
    "search_type": "similarity",  # 'similarity', 'mmr', or 'similarity_score_threshold'
    "top_k": 4,  # Documents to retrieve
    "top_n": 3,  # Final results to return
    "score_threshold": 0.5,  # For similarity_score_threshold type
    "fetch_k": 20,  # For MMR search
    "lambda_mult": 0.5  # MMR diversity (0=max diversity, 1=min diversity)
}
response = requests.post(f"http://localhost:${port}/v1/kb/{kb_id}/search", json=advanced_search)
results = response.json()
print("Advanced search results:", results)

# Delete knowledge base
response = requests.delete(f"http://localhost:${port}/v1/kb/{kb_id}")
print("Delete KB result:", response.json())`,
    },
    {
      language: 'JavaScript',
      languageCode: 'js' as const,
      code: `import fetch from 'node-fetch'

// Get all knowledge bases
let response = await fetch('http://localhost:${port}/v1/kb')
const knowledgeBases = await response.json()
console.log('Knowledge Bases:', knowledgeBases)

// Get specific knowledge base
const kbId = 1
response = await fetch(\`http://localhost:${port}/v1/kb/\${kbId}\`)
const kbDetails = await response.json()
console.log('KB Details:', kbDetails)

// Get files in a knowledge base
response = await fetch(\`http://localhost:${port}/v1/kb/\${kbId}/files\`)
const files = await response.json()
console.log('Files:', files)

// Delete a file from knowledge base
const fileData = { name: 'document.pdf' }
response = await fetch(\`http://localhost:${port}/v1/kb/\${kbId}/files\`, {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(fileData),
})
const deleteFileResult = await response.json()
console.log('Delete result:', deleteFileResult)

// Search in knowledge base with basic query
const searchData = { query: 'your search query' }
response = await fetch(\`http://localhost:${port}/v1/kb/\${kbId}/search\`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(searchData)
})
let results = await response.json()
console.log('Search results:', results)

// Advanced search with parameters
const advancedSearch = {
  query: 'your search query',
  search_type: 'similarity', // 'similarity', 'mmr', or 'similarity_score_threshold'
  top_k: 4, // Documents to retrieve
  top_n: 3, // Final results to return
  score_threshold: 0.5, // For similarity_score_threshold type
  fetch_k: 20, // For MMR search
  lambda_mult: 0.5 // MMR diversity (0=max diversity, 1=min diversity)
}
response = await fetch(\`http://localhost:${port}/v1/kb/\${kbId}/search\`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(advancedSearch)
})
results = await response.json()
console.log('Advanced search results:', results)

// Delete knowledge base
response = await fetch(\`http://localhost:${port}/v1/kb/\${kbId}\`, {
  method: 'DELETE',
})
const deleteKbResult = await response.json()
console.log('Delete result:', deleteKbResult)`,
    },
  ]

  const chunkManagementSnippet = [
    {
      language: 'Python',
      languageCode: 'py' as const,
      code: `import requests

kb_id = 1

# Get all chunks from a knowledge base
response = requests.get(f"http://localhost:${port}/v1/kb/{kb_id}/chunks")
chunks = response.json()
print(f"Found {chunks['total_chunks']} chunks")

# Get chunks with embedding vectors included
response = requests.get(f"http://localhost:${port}/v1/kb/{kb_id}/chunks?include_embeddings=true")
chunks_with_embeddings = response.json()
print("Chunks with embeddings:", len(chunks_with_embeddings['chunks']))

# Add a new chunk manually
chunk_data = {
    "content": "This is a manually added text chunk.",
    "metadata": {"source": "manual_entry"}
}
response = requests.post(f"http://localhost:${port}/v1/kb/{kb_id}/chunks", json=chunk_data)
result = response.json()
print("Added chunk:", result)

# Delete specific chunks by document IDs
doc_ids = [chunk["doc_id"] for chunk in chunks["chunks"][:2]]
delete_data = {"doc_ids": doc_ids}
response = requests.delete(f"http://localhost:${port}/v1/kb/{kb_id}/chunks", json=delete_data)
delete_result = response.json()
print("Deletion result:", delete_result)`,
    },
    {
      language: 'JavaScript',
      languageCode: 'js' as const,
      code: `import fetch from 'node-fetch'
      
const kbId = kb.id

// Get all chunks from a knowledge base
let response = await fetch(\`http://localhost:${port}/v1/kb/\${kbId}/chunks\`)
const chunks = await response.json()
console.log(\`Found \${chunks.total_chunks} chunks\`)

// Get chunks with embedding vectors included
response = await fetch(\`http://localhost:${port}/v1/kb/\${kbId}/chunks?include_embeddings=true\`)
const chunksWithEmbeddings = await response.json()
console.log('Chunks with embeddings:', chunksWithEmbeddings.chunks.length)

// Add a new chunk manually
const chunkData = {
  content: 'This is a manually added text chunk.',
  metadata: { source: 'manual_entry' }
}
response = await fetch(\`http://localhost:${port}/v1/kb/\${kbId}/chunks\`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(chunkData)
})
const result = await response.json()
console.log('Added chunk:', result)

// Delete specific chunks by document IDs
const docIdsToDelete = chunks.chunks.slice(0, 2).map((chunk) => chunk.doc_id)
const deleteData = { doc_ids: docIdsToDelete }
response = await fetch(\`http://localhost:${port}/v1/kb/\${kbId}/chunks\`, {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(deleteData)
})
const deleteResult = await response.json()
console.log('Deletion result:', deleteResult)`,
    },
  ]

  const rerankSnippet = [
    {
      language: 'Python',
      languageCode: 'py' as const,
      code: `import cohere

client = cohere.Client(
    base_url="http://localhost:${port}",
    api_key="unused"
)

docs = [
    "Carson City is the capital city of the American state of Nevada.",
    "The Commonwealth of the Northern Mariana Islands is a group of islands in the Pacific Ocean. Its capital is Saipan.",
    "Capitalization or capitalisation in English grammar is the use of a capital letter at the start of a word. English usage varies from capitalization in other languages.",
    "Washington, D.C. (also known as simply Washington or D.C., and officially as the District of Columbia) is the capital of the United States. It is a federal district.",
    "Capital punishment has existed in the United States since beforethe United States was a country. As of 2017, capital punishment is legal in 30 of the 50 states.",
]

response = client.rerank(
    model="OpenVINO/bge-reranker-base-int8-ov",
    query="What is the capital of the United States?",
    documents=docs,
    top_n=3,
    return_documents=True,
)
print(response)`,
    },
    {
      language: 'JavaScript',
      languageCode: 'js' as const,
      code: `import { CohereClient } from 'cohere-ai'

const cohere = new CohereClient({
  baseUrl: 'http://localhost:${port}',
  token: 'unused',
})

const rerank = await cohere.rerank({
  documents: [
    'Carson City is the capital city of the American state of Nevada.',
    'The Commonwealth of the Northern Mariana Islands is a group of islands in the Pacific Ocean. Its capital is Saipan.',
    'Capitalization or capitalisation in English grammar is the use of a capital letter at the start of a word. English usage varies from capitalization in other languages.',
    'Washington, D.C. (also known as simply Washington or D.C., and officially as the District of Columbia) is the capital of the United States. It is a federal district.',
    'Capital punishment has existed in the United States since beforethe United States was a country. As of 2017, capital punishment is legal in 30 of the 50 states.',
  ],
  query: 'What is the capital of the United States?',
  topN: 3,
  model: 'OpenVINO/bge-reranker-base-int8-ov',
  returnDocuments: true,
})

console.log(rerank)`,
    },
  ]

  return (
    <div className="grid gap-8 lg:grid-cols-4">
      {/* Main Documentation Content */}
      <div className="lg:col-span-4">
        <div className="space-y-8">
          {/* Header */}
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-slate-900">
                  Embedding API
                </h1>
              </div>
            </div>
          </div>

          <div id="overview" className="prose flex max-w-none flex-col gap-4">
            {/* Embedding service */}
            <p className="leading-relaxed text-slate-700">
              This embedding service provides vector embeddings for text using
              advanced language models through&nbsp;
              <a
                className="text-primary font-medium"
                target="_blank"
                href="https://docs.openvino.ai/2025/model-server/ovms_what_is_openvino_model_server.html"
              >
                OpenVINO Model Server
              </a>
              &nbsp;acceleration. It includes a FAISS vector database for
              document storage and supports RAG (Retrieval-Augmented Generation)
              workflows with Knowledge Base management, file upload, and
              semantic search capabilities.
            </p>
            <p className="leading-relaxed text-slate-700">
              The service provides multiple APIs: OpenAI-compatible embedding
              generation, Cohere-compatible document reranking, and a
              comprehensive Knowledge Base API for managing document
              collections. Advanced features include chunk-level management,
              multiple search algorithms (similarity, MMR, score threshold), and
              embedding vector access. You can use standard OpenAI and Cohere
              client libraries, while leveraging the Knowledge Base system for
              building sophisticated RAG applications directly on your edge
              device.
            </p>

            <p className="leading-relaxed text-slate-700">
              Here&apos;s how to generate embeddings using the&nbsp;
              <a
                className="text-primary font-medium"
                target="_blank"
                href="https://platform.openai.com/docs/api-reference/embeddings"
              >
                OpenAI Library
              </a>
              :
            </p>
            <CodeBlock
              title={'Generate embeddings with OpenAI API'}
              data={embeddingsAPISnippet}
            />

            <p className="text-lg leading-relaxed font-semibold text-slate-700">
              Knowledge Base Management
            </p>
            <p className="leading-relaxed text-slate-700">
              The service provides a comprehensive Knowledge Base API for
              organizing and managing document collections. Create knowledge
              bases, upload documents (PDF), and generate embeddings for
              semantic search capabilities.
            </p>
            <CodeBlock
              title={'Create Knowledge Base and Upload Documents'}
              data={knowledgeBaseSnippet}
            />

            <p className="text-lg leading-relaxed font-semibold text-slate-700">
              Knowledge Base Operations
            </p>
            <p className="leading-relaxed text-slate-700">
              Manage your knowledge bases with full CRUD operations, file
              management, and semantic search capabilities:
            </p>
            <CodeBlock
              title={'Manage Knowledge Bases and Search Documents'}
              data={knowledgeBaseManagementSnippet}
            />

            <p className="text-lg leading-relaxed font-semibold text-slate-700">
              Chunk Management
            </p>
            <p className="leading-relaxed text-slate-700">
              The API provides direct access to individual text chunks within
              knowledge bases. You can view, add, and delete chunks, optionally
              including embedding vectors:
            </p>
            <CodeBlock
              title={'Manage Text Chunks in Knowledge Bases'}
              data={chunkManagementSnippet}
            />

            <p className="text-lg leading-relaxed font-semibold text-slate-700">
              Document Reranking
            </p>
            <p className="leading-relaxed text-slate-700">
              The reranking API is Cohere-compatible and improves search result
              relevance by reordering documents based on their relevance to a
              query. You can use the official Cohere Python client or direct API
              calls:
            </p>
            <CodeBlock
              title={'Rerank Documents by Relevance'}
              data={rerankSnippet}
            />

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

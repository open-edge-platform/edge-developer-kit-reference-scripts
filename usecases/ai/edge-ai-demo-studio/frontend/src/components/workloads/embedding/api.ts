// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { EndpointProps } from '../endpoint'

export const embeddingEndpoints: EndpointProps[] = [
  {
    title: 'Create Embeddings',
    description:
      'Generate embeddings for text input using OpenVINO Model Server with OpenAI-compatible API.',
    path: '/v1/embeddings',
    body: `{
  "input": "The quick brown fox jumps over the lazy dog",
  "model": "OpenVINO/bge-base-en-v1.5-int8-ov",
  "encoding_format": "float"
}`,
    method: 'POST',
    headers: `Content-Type: application/json`,
    exampleResponse: `{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "embedding": [
        0.0023064255,
        -0.009327292,
        0.0028842222,
        ...
      ],
      "index": 0
    }
  ],
  "model": "OpenVINO/bge-base-en-v1.5-int8-ov",
  "usage": {
    "prompt_tokens": 10,
    "total_tokens": 10
  }
}`,
    parameters: [
      {
        name: 'input',
        description:
          'Input text to embed, encoded as a string or array of tokens.',
        required: true,
      },
      {
        name: 'model',
        description:
          'ID of the model to use. Must match the model configured in the embedding service.',
        required: true,
      },
      {
        name: 'encoding_format',
        description:
          'The format to return the embeddings in. Can be either "float" or "base64".',
        required: false,
      },
    ],
  },
  {
    title: 'Rerank Documents',
    description:
      'Rerank documents based on relevance to a query using OpenVINO Model Server Cohere-compatible API.',
    path: '/v1/rerank',
    body: `{
  "model": "OpenVINO/bge-reranker-base-int8-ov",
  "query": "What is the capital of the United States?",
  "documents": [
    "Carson City is the capital city of the American state of Nevada.",
    "The Commonwealth of the Northern Mariana Islands is a group of islands in the Pacific Ocean. Its capital is Saipan.",
    "Capitalization or capitalisation in English grammar is the use of a capital letter at the start of a word. English usage varies from capitalization in other languages.",
    "Washington, D.C. is the capital of the United States.",
    "Capital punishment has existed in the United States since before the United States was a country."
  ],
  "top_n": 3,
  "return_documents": true
}`,
    method: 'POST',
    headers: `Content-Type: application/json`,
    exampleResponse: `{
  "id": null,
  "results": [
    {
      "document": {
        "text": "Washington, D.C. is the capital of the United States."
      },
      "index": 3,
      "relevance_score": 0.9882849454879761
    },
    {
      "document": {
        "text": "Carson City is the capital city of the American state of Nevada."
      },
      "index": 0,
      "relevance_score": 0.5000976324081421
    },
    {
      "document": {
        "text": "The Commonwealth of the Northern Mariana Islands is a group of islands in the Pacific Ocean. Its capital is Saipan."
      },
      "index": 1,
      "relevance_score": 0.03262948617339134
    }
  ],
  "meta": null
}`,
    parameters: [
      {
        name: 'model',
        description: 'ID of the reranking model to use.',
        required: true,
      },
      {
        name: 'query',
        description: 'The search query to rank documents against.',
        required: true,
      },
      {
        name: 'documents',
        description: 'Array of documents to rerank.',
        required: true,
      },
      {
        name: 'top_n',
        description: 'Number of top documents to return.',
        required: false,
      },
      {
        name: 'return_documents',
        description: 'Whether to return the document text in the response.',
        required: false,
      },
    ],
  },
  {
    title: 'List Knowledge Bases',
    description:
      'Retrieve all available knowledge bases for document management and RAG workflows.',
    path: '/v1/kb',
    method: 'GET',
    exampleResponse: `[
  {
    "name": "Research Papers",
    "db": "",
    "id": 1
  },
  {
    "name": "Company Docs",
    "db": "",
    "id": 2
  }
]`,
    parameters: [],
  },
  {
    title: 'Create Knowledge Base',
    description:
      'Create a new knowledge base for organizing and managing documents.',
    path: '/v1/kb',
    body: `{
  "name": "My Knowledge Base"
}`,
    method: 'POST',
    headers: `Content-Type: application/json`,
    exampleResponse: `{
  "name": "My Knowledge Base",
  "db": "",
  "id": 1
}`,
    parameters: [
      {
        name: 'name',
        description: 'Name of the knowledge base',
        required: true,
      },
    ],
  },
  {
    title: 'Get Knowledge Base',
    description: 'Retrieve details of a specific knowledge base by ID.',
    path: '/v1/kb/{id}',
    method: 'GET',
    exampleResponse: `{
  "name": "Research Papers",
  "db": "",
  "id": 1
}`,
    parameters: [
      {
        name: 'id',
        description: 'Knowledge base ID',
        required: true,
      },
    ],
  },
  {
    title: 'Delete Knowledge Base',
    description:
      'Delete a knowledge base and all its associated files and embeddings. Will return list of remaining knowledge bases.',
    path: '/v1/kb/{id}',
    method: 'DELETE',
    exampleResponse: `[]`,
    parameters: [
      {
        name: 'id',
        description: 'Knowledge base ID to delete',
        required: true,
      },
    ],
  },
  {
    title: 'Upload File to Knowledge Base',
    description: 'Upload documents (PDF) to a specific knowledge base.',
    path: '/v1/kb/{id}/files',
    method: 'POST',
    headers: `Content-Type: multipart/form-data`,
    formData: ['file=@document.pdf'],
    exampleResponse: `{
  "message": "Successfully uploaded document.pdf"
}`,
    parameters: [
      {
        name: 'id',
        description: 'Knowledge base ID to upload files to',
        required: true,
      },
      {
        name: 'file',
        description: 'File to upload (PDF format supported)',
        required: true,
      },
    ],
  },
  {
    title: 'List Files in Knowledge Base',
    description: 'Retrieve all files uploaded to a specific knowledge base.',
    path: '/v1/kb/{id}/files',
    method: 'GET',
    exampleResponse: `[
  {
    "id": 1,
    "name": "document.pdf",
    "ext": ""
  },
  {
    "id": 2,
    "name": "notes.pdf",
    "ext": ""
  }
]`,
    parameters: [
      {
        name: 'id',
        description: 'Knowledge base ID',
        required: true,
      },
    ],
  },
  {
    title: 'Delete File from Knowledge Base',
    description: 'Delete a specific file from a knowledge base.',
    path: '/v1/kb/{id}/files',
    body: `{
  "name": "document.pdf"
}`,
    method: 'DELETE',
    headers: `Content-Type: application/json`,
    exampleResponse: `{
  "message": "Successfully deleted document.pdf"
}`,
    parameters: [
      {
        name: 'id',
        description: 'Knowledge base ID',
        required: true,
      },
      {
        name: 'name',
        description: 'Name of the file to delete',
        required: true,
      },
    ],
  },
  {
    title: 'Create Embeddings for Knowledge Base',
    description:
      'Process all uploaded files in a knowledge base and create embeddings for semantic search. Supports configurable text splitting and chunking parameters.',
    path: '/v1/kb/{id}/create',
    body: `{
  "splitter_name": "RecursiveCharacter",
  "chunk_size": 1000,
  "chunk_overlap": 200
}`,
    method: 'POST',
    headers: `Content-Type: application/json`,
    exampleResponse: `{
  "status": true,
  "message": "Successfully created embeddings for 1",
  "config": {
    "splitter_name": "RecursiveCharacter",
    "chunk_size": 1000,
    "chunk_overlap": 200
  }
}`,
    parameters: [
      {
        name: 'id',
        description: 'Knowledge base ID to create embeddings for',
        required: true,
      },
      {
        name: 'splitter_name',
        description:
          'Type of text splitter: "Character", "RecursiveCharacter", or "Markdown"',
        required: false,
      },
      {
        name: 'chunk_size',
        description: 'Size of each text chunk (default: 1000)',
        required: false,
      },
      {
        name: 'chunk_overlap',
        description: 'Overlap between chunks (default: 200)',
        required: false,
      },
    ],
  },
  {
    title: 'Search Knowledge Base',
    description:
      'Perform semantic search within a knowledge base using various search algorithms and return relevant document chunks.',
    path: '/v1/kb/{id}/search',
    body: `{
  "query": "machine learning fundamentals",
  "search_type": "similarity",
  "top_k": 4,
  "top_n": 3,
  "score_threshold": 0.5,
  "fetch_k": 20,
  "lambda_mult": 0.5
}`,
    method: 'POST',
    headers: `Content-Type: application/json`,
    exampleResponse: `[
  {
    "content": "Machine learning is a subset of artificial intelligence...",
    "metadata": {
      "producer": "Microsoft® Word for Microsoft 365",
      "creator": "Microsoft® Word for Microsoft 365",
      "creationdate": "2025-04-15T09:41:32+08:00",
      "author": "John Smith",
      "moddate": "2025-04-15T09:41:32+08:00",
      "total_pages": 3,
      "source": "./data/1/ai_fundamentals.pdf",
      "relevance_score": 0.00024651215062476695
    }
  },
  {
    "content": "Deep learning models require large datasets for training...",
    "metadata": {
      "producer": "Microsoft® Word for Microsoft 365",
      "creator": "Microsoft® Word for Microsoft 365",
      "creationdate": "2025-04-15T09:41:32+08:00",
      "author": "Jane Doe",
      "moddate": "2025-04-15T09:41:32+08:00",
      "total_pages": 12,
      "source": "./data/1/deep_learning_guide.pdf",
      "relevance_score": 5.162182787898928e-05
    }
  }
]`,
    parameters: [
      {
        name: 'id',
        description: 'Knowledge base ID to search',
        required: true,
      },
      {
        name: 'query',
        description: 'Search query string for semantic matching',
        required: true,
      },
      {
        name: 'search_type',
        description:
          'Type of search: "similarity", "mmr", or "similarity_score_threshold"',
        required: false,
      },
      {
        name: 'top_k',
        description:
          'Number of documents to retrieve from vector search (default: 4)',
        required: false,
      },
      {
        name: 'top_n',
        description:
          'Number of documents to return after reranking (default: 3)',
        required: false,
      },
      {
        name: 'score_threshold',
        description:
          'Minimum relevance threshold (only for similarity_score_threshold)',
        required: false,
      },
      {
        name: 'fetch_k',
        description:
          'Amount of documents to pass to MMR algorithm (only for mmr, default: 20)',
        required: false,
      },
      {
        name: 'lambda_mult',
        description:
          'Diversity of results returned by MMR (only for mmr, 0=max diversity, 1=min diversity, default: 0.5)',
        required: false,
      },
      {
        name: 'filter',
        description: 'Filter by document metadata (optional)',
        required: false,
      },
    ],
  },
  {
    title: 'Get Knowledge Base Chunks',
    description:
      'Retrieve all text chunks from a knowledge base with optional embedding vectors.',
    path: '/v1/kb/{id}/chunks',
    method: 'GET',
    exampleResponse: `{
  "kb_id": 1,
  "total_chunks": 25,
  "chunks": [
    {
      "chunk_id": 0,
      "doc_id": "doc_123456",
      "content": "Machine learning is a subset of artificial intelligence...",
      "metadata": {
        "producer": "Microsoft® Word for Microsoft 365",
        "creator": "Microsoft® Word for Microsoft 365",
        "creationdate": "2025-04-15T09:41:32+08:00",
        "author": "John Doe",
        "moddate": "2025-04-15T09:41:32+08:00",
        "total_pages": 4,
        "source": "./data/1/ml_guide.pdf",
      }
    },
    {
      "chunk_id": 1,
      "doc_id": "doc_123457",
      "content": "Deep neural networks consist of multiple layers...",
      "metadata": {
        "source": "manual_entry"
      }
    }
  ]
}`,
    parameters: [
      {
        name: 'id',
        description: 'Knowledge base ID',
        required: true,
      },
      {
        name: 'include_embeddings',
        description:
          'Include embedding vectors in the response (query parameter, default: false)',
        required: false,
      },
    ],
  },
  {
    title: 'Add Chunk to Knowledge Base',
    description:
      'Manually add a text chunk to a knowledge base with optional metadata.',
    path: '/v1/kb/{id}/chunks',
    body: `{
  "content": "This is a manually added text chunk about AI concepts.",
  "metadata": {
    "source": "manual_entry",
    "author": "John Doe"
  }
}`,
    method: 'POST',
    headers: `Content-Type: application/json`,
    exampleResponse: `{
  "success": true,
  "chunk_id": "chunk_26",
  "doc_id": "doc_789012",
  "message": "Chunk added successfully to knowledge base 1"
}`,
    parameters: [
      {
        name: 'id',
        description: 'Knowledge base ID',
        required: true,
      },
      {
        name: 'content',
        description: 'Text content of the chunk',
        required: true,
      },
      {
        name: 'metadata',
        description: 'Optional metadata for the chunk (JSON object)',
        required: false,
      },
    ],
  },
  {
    title: 'Delete Chunks from Knowledge Base',
    description:
      'Delete specific chunks from a knowledge base by their document IDs.',
    path: '/v1/kb/{id}/chunks',
    body: `{
  "doc_ids": ["doc_123456", "doc_123457", "doc_789012"]
}`,
    method: 'DELETE',
    headers: `Content-Type: application/json`,
    exampleResponse: `{
  "success": true,
  "message": "Successfully deleted chunks from knowledge base 1",
  "deletion_info": {
    "deleted_count": 3,
    "failed_deletions": []
  }
}`,
    parameters: [
      {
        name: 'id',
        description: 'Knowledge base ID',
        required: true,
      },
      {
        name: 'doc_ids',
        description: 'Array of document IDs to delete from the knowledge base',
        required: true,
      },
    ],
  },
]

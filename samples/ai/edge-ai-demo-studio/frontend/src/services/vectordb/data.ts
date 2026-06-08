// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Database } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import type { ServiceMeta, WorkerConfig } from '@/services/types'

export const service: ServiceMeta = {
  id: 'vectordb',
  name: 'Vector Database',
  description:
    'FAISS-based vector storage for knowledge base management, semantic search, and RAG pipelines.',
  longDescription:
    'Lightweight vector database service providing CRUD operations for knowledge bases, document ingestion with automatic chunking, and similarity search. Supports both text-based embedding (via external embedding services) and direct pre-computed vector storage. Built on FAISS for fast nearest-neighbor retrieval.',
  icon: Database,
  port: 8017,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  logSources: [{ type: 'service', label: 'vectordb', target: 'vectordb' }],
  prerequisiteServices: ['embeddings'],
  healthCheck: {
    url: '/healthcheck',
  },
}

export const worker: WorkerConfig = {
  buildArgs: (doc: PayloadService) => {
    const args = ['--port', String(doc.port)]
    return args
  },
  workerSubDir: 'vectordb',
}

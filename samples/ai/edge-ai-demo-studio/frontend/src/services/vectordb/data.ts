// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Database } from 'lucide-react'
import { getServiceMetadata } from '@/lib/instances/service-metadata'
import type { Service as PayloadService } from '@/payload-types'
import type { ServiceMeta, WorkerConfig } from '@/services/types'

export const service: ServiceMeta = {
  id: 'vectordb',
  name: 'Vector Database',
  multiInstance: true,
  description:
    'Vector storage for knowledge base management, semantic search, and RAG pipelines, backed by FAISS or PostgreSQL + pgvector.',
  longDescription:
    'Lightweight vector database service providing CRUD operations for knowledge bases, document ingestion with automatic chunking, and similarity search. Supports both text-based embedding (via external embedding services) and direct pre-computed vector storage. Vectors are kept either in a FAISS index per knowledge base (default) or in PostgreSQL + pgvector, embedded or external, using the Open Edge Platform document-ingestion pipeline.',
  icon: Database,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  logSources: [{ type: 'service', label: 'vectordb', target: 'vectordb' }],
  prerequisiteServices: ['embeddings'],
  runtimeLabel: (instance) =>
    getServiceMetadata(instance).vectorDbBackend === 'pgvector'
      ? 'pgvector'
      : 'FAISS',
  healthCheck: {
    url: '/healthcheck',
  },
}

export const worker: WorkerConfig = {
  buildArgs: (doc: PayloadService) => {
    const args = ['--port', String(doc.port)]

    const metadata = getServiceMetadata(doc)
    const backend =
      metadata.vectorDbBackend === 'pgvector' ? 'pgvector' : 'faiss'
    args.push('--db-backend', backend)

    const pgConnectionString = metadata.pgConnectionString?.trim()
    if (backend === 'pgvector' && pgConnectionString) {
      args.push('--pg-connection-string', pgConnectionString)
    }

    return args
  },
}

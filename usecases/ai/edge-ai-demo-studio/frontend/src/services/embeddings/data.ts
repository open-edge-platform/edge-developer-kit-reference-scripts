// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FileText } from 'lucide-react'
import type { ServiceMeta } from '@/services/types'
import {
  getMultiserveDefaultModel,
  getMultiserveServiceConfig,
} from '../../engines/multiserve/config'

export const service: ServiceMeta = {
  id: 'embeddings',
  name: 'Text Embedding',
  description:
    'Generate dense vector embeddings for semantic search and RAG pipelines.',
  longDescription:
    'Text embedding service generating high-quality dense vectors for semantic search, retrieval-augmented generation, and document clustering. Optimized for Intel hardware with OpenVINO acceleration. Supports batch processing and automatic chunking.',
  icon: FileText,
  port: 8006,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'multiserve' },
  defaultModel: getMultiserveDefaultModel('embeddings'),
  config: getMultiserveServiceConfig('embeddings'),
  logSources: [{ type: 'service', label: 'embeddings', target: 'embeddings' }],
}

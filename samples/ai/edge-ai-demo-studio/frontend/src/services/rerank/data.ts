// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ArrowUpDown } from 'lucide-react'
import type { ServiceMeta } from '@/services/types'
// NOTE: relative path (not the @/ alias) is required — this data.ts is loaded
// by next.config.ts in a CommonJS context where @/ runtime imports don't resolve.
import {
  getMultiserveDefaultModel,
  getMultiserveServiceConfig,
} from '../../engines/multiserve/config'

export const service: ServiceMeta = {
  id: 'rerank',
  name: 'Reranker',
  description:
    'Rescore and rerank documents by relevance for improved search and RAG pipelines.',
  longDescription:
    'Cross-encoder reranking service that rescores candidate documents against a query for precise relevance ordering. Optimized for Intel hardware with OpenVINO acceleration. Ideal for improving retrieval quality in RAG, search, and recommendation systems.',
  icon: ArrowUpDown,
  port: 8012,
  reservedPorts: [8013, 8014, 8015, 8016],
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'multiserve' },
  defaultModel: getMultiserveDefaultModel('rerank'),
  config: getMultiserveServiceConfig('rerank'),
  logSources: [{ type: 'service', label: 'rerank', target: 'rerank' }],
}

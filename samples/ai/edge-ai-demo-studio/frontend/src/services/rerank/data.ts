// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ArrowUpDown } from 'lucide-react'
import type { ServiceMeta } from '@/services/types'
// Relative path, not @/: next.config.ts loads this file where @/ runtime imports don't resolve.
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
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'multiserve' },
  multiInstance: true,
  defaultModel: getMultiserveDefaultModel('rerank'),
  config: getMultiserveServiceConfig('rerank'),
  logSources: [{ type: 'service', label: 'rerank', target: 'rerank' }],
}

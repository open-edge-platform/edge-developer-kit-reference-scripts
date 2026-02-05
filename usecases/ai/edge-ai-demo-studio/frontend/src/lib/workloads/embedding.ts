// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { EMBEDDING_PORT } from '@/lib/constants'
import {
  DEFAULT_MULTISERVE_FIELDS,
  getDefaultModelForEngine,
  MULTISERVE_ENGINES,
} from '../engine/multiserve'
import { CreateWorkload } from '@/types/workload'

export const EMBEDDING_TYPE = 'embeddings' as const
export const RERANKER_TYPE = 'rerank' as const

export const EMBEDDING_DESCRIPTION =
  'Generate vector embeddings and manage documents for RAG workflows using advanced language models with OpenVINO acceleration.'

export const EMBEDDING_URL = '/api/embeddings'

export const EMBEDDING_ENGINES = [...MULTISERVE_ENGINES]

export const EMBEDDING_WORKLOAD: CreateWorkload = {
  name: EMBEDDING_TYPE,
  type: EMBEDDING_TYPE,
  models: {
    default: getDefaultModelForEngine(
      DEFAULT_MULTISERVE_FIELDS.engine,
      EMBEDDING_TYPE,
    ),
    rerank: getDefaultModelForEngine(
      DEFAULT_MULTISERVE_FIELDS.engine,
      RERANKER_TYPE,
    ),
  },
  port: EMBEDDING_PORT,
  ...DEFAULT_MULTISERVE_FIELDS,
  healthCheck: {
    url: '/healthcheck',
  },
}

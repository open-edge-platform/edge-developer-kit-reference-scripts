// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { EMBEDDING_PORT } from '@/lib/constants'

export const EMBEDDING_TYPE = 'embedding' as const

export const EMBEDDING_DESCRIPTION =
  'Generate vector embeddings and manage documents for RAG workflows using advanced language models with OpenVINO acceleration.'

export const EMBEDDING_MODELS = [
  {
    name: 'OpenVINO/bge-base-en-v1.5-int8-ov',
    value: 'OpenVINO/bge-base-en-v1.5-int8-ov',
    type: 'predefined',
  },
]

export const EMBEDDING_RERANKER_MODELS = [
  {
    name: 'OpenVINO/bge-reranker-base-int8-ov',
    value: 'OpenVINO/bge-reranker-base-int8-ov',
    type: 'predefined',
  },
]

export const EMBEDDING_WORKLOAD = {
  name: EMBEDDING_TYPE,
  type: EMBEDDING_TYPE,
  model: EMBEDDING_MODELS[0].value,
  device: 'CPU',
  port: EMBEDDING_PORT,
  metadata: {
    rerankerModel: EMBEDDING_RERANKER_MODELS[0].value,
    rerankerDevice: 'CPU',
  },
  healthUrl: '/healthcheck',
}

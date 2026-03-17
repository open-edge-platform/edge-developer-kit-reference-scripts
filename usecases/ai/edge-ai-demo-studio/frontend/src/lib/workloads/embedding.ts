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
    url: '/multiserve/v1/status',
    responseMapper: {
      ...DEFAULT_MULTISERVE_FIELDS.healthCheck.responseMapper,
      'models.rerank.name':
        "($id := $workload.models.rerank.quant ? $workload.models.rerank.name & ':' & $workload.models.rerank.quant : $workload.models.rerank.name; $matched := status[repo_id=$id and task='rerank']; $split($matched.repo_id, ':')[0])",
      'models.rerank.quant':
        "($id := $workload.models.rerank.quant ? $workload.models.rerank.name & ':' & $workload.models.rerank.quant : $workload.models.rerank.name; $matched := status[repo_id=$id and task='rerank']; $split($matched.repo_id, ':')[1])",
      '($d := $lowercase(models.rerank.device); $replace($d, /^gpu(\\..*)?$/, "gpu"))':
        "($id := $workload.models.rerank.quant ? $workload.models.rerank.name & ':' & $workload.models.rerank.quant : $workload.models.rerank.name; $dev := $lowercase(status[repo_id=$id and task='rerank'].device); $replace($dev, /^gpu(\\..*)?$/, 'gpu'))",
    },
  },
}

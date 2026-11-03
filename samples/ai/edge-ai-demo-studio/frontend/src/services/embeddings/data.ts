// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FileText } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import { getEffectivePrecision } from '@/services/model-config'
import type { ServiceMeta, WorkerConfig } from '@/services/types'
import { getMultiserveDefaultModel } from '../../engines/multiserve/config'
import {
  DEFAULT_OEP_EMBEDDING_MODEL,
  embeddingsConfig,
  oepEmbeddingsConfig,
} from './config'

export const service: ServiceMeta = {
  id: 'embeddings',
  name: 'Text Embedding',
  description:
    'Generate dense vector embeddings for semantic search and RAG pipelines, with optional image embeddings through the Open Edge Platform multimodal models.',
  longDescription:
    'Embedding service generating high-quality dense vectors for semantic search, retrieval-augmented generation, and document clustering, exposed through an OpenAI-compatible endpoint. Runs on one of two engines selectable in the UI: the multiserve engine serves text embedding models on OpenVINO Model Server or llama.cpp; the Open Edge Platform multimodal-embedding-serving microservice, run natively, adds CLIP and SigLIP models that embed text and images into one vector space, plus OpenVINO Qwen3 text embeddings. Supports batch processing and automatic chunking.',
  icon: FileText,
  supportedOS: ['linux', 'windows'],
  multiInstance: true,
  execution: {
    // The stored `engine` decides which one runs.
    mode: ['multiserve', 'worker'],
    options: [
      {
        mode: 'multiserve',
        label: 'Text · Multiserve',
        description:
          'Text embedding models on OpenVINO Model Server or llama.cpp.',
      },
      {
        mode: 'worker',
        label: 'Text + Image · OEP',
        description:
          'Open Edge Platform multimodal embeddings (CLIP, SigLIP, Qwen3) on OpenVINO, run natively.',
        defaultModel: { name: DEFAULT_OEP_EMBEDDING_MODEL, device: 'AUTO' },
      },
    ],
  },
  defaultModel: getMultiserveDefaultModel('embeddings'),
  config: embeddingsConfig,
  logSources: [{ type: 'service', label: 'embeddings', target: 'embeddings' }],
  // `worker` engine only; multiserve carries its own backend health check.
  healthCheck: {
    url: '/healthcheck',
  },
}

/** The OEP worker's tuning flags from its Runtime Settings; unset ones keep its per-device defaults. */
function oepTuningArgs(metadata: PayloadService['metadata']): string[] {
  const args: string[] = []
  const batchSize = metadata?.embeddingBatchSize
  if (typeof batchSize === 'number' && Number.isInteger(batchSize)) {
    args.push('--batch-size', String(batchSize))
  }
  if (metadata?.performanceMode) {
    args.push('--performance-mode', metadata.performanceMode)
  }
  if (metadata?.compiledModelCache === true) args.push('--model-cache')
  return args
}

export const worker: WorkerConfig = {
  modelCatalog: 'script',
  buildArgs: (doc: PayloadService) => {
    const model = doc.models?.default?.name || DEFAULT_OEP_EMBEDDING_MODEL
    // Only the Qwen text models are exported at a chosen precision.
    const precision = /^QwenText\//.test(model)
      ? getEffectivePrecision(oepEmbeddingsConfig, doc.models?.default?.quant)
      : undefined
    return [
      '--port',
      String(doc.port),
      '--model',
      model,
      '--device',
      doc.models?.default?.device || 'AUTO',
      ...(precision ? ['--precision', precision] : []),
      ...oepTuningArgs(doc.metadata),
    ]
  },
  // models/huggingface: the Hugging Face cache all workers share.
  modelDirectories: ['models/embeddings', 'models/huggingface'],
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ExecutionModeConfigurePanel } from '@/services/common/configure/service-configure-dispatch'
import type { Service } from '@/services/types'
import { getEffectiveModel } from '@/types/service'
import {
  DEFAULT_OEP_EMBEDDING_MODEL,
  isOepEmbeddingModel,
  oepEmbeddingsConfig,
} from '../config'
import { OepEmbeddingsWorkerPanel } from './oep-worker-panel'

/**
 * Worker panel view: OEP models only. A multiserve model name left on the record (engine just
 * switched) shows as the OEP default.
 */
function oepView(service: Service): Service {
  const currentModel = getEffectiveModel(service).name
  return {
    ...service,
    config: oepEmbeddingsConfig,
    currentModel: isOepEmbeddingModel(currentModel)
      ? currentModel
      : DEFAULT_OEP_EMBEDDING_MODEL,
    defaultModel: { name: DEFAULT_OEP_EMBEDDING_MODEL, device: 'AUTO' },
  }
}

/** Engine tabs, then the settings of the stored engine: multiserve, or the worker panel on OEP models. */
export function EmbeddingsConfigurePanel({ service }: { service: Service }) {
  return (
    <ExecutionModeConfigurePanel
      service={service}
      workerView={oepView}
      WorkerPanel={OepEmbeddingsWorkerPanel}
    />
  )
}

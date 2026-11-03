// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Service } from '@/payload-types'
import type { Engine } from '../types'
import { supportedBackends } from './backends'
import { MULTISERVE_HEALTH_URL } from './health'

// Client-safe: the browser reads this through `@/engines/registry`. Paths,
// processes and probes live in `./server.ts`.

const getModelName = (
  modelConfig: Service['models']['default'],
  inference: boolean = false,
) => {
  let modelName = modelConfig.name
  if (modelConfig.backend === 'llamacpp') {
    modelName = modelConfig.quant
      ? `${modelConfig.name}:${modelConfig.quant}`
      : modelConfig.name
  }
  if (inference) {
    return `${modelConfig.backend}:${modelName}`
  }

  return modelName
}

export const engine: Engine = {
  name: 'Multiserve',
  value: 'multiserve',
  description:
    'A custom engine that runs models on the OpenVINO or llama.cpp backend',
  supportedBackends,
  // One port per instance: the model servers the engine starts pick free loopback ports outside
  // the instance range, and the engine proxies them (`/v1/status` lists their URLs).
  getModelName,
  healthUrl: MULTISERVE_HEALTH_URL,
  // The model server's log, which `/api/logs` reads from disk: the engine
  // is stopped when its model fails, and its `/v1/logs` with it.
  getLogs: () => [
    { type: 'engine', label: 'multiserve', target: 'multiserve' },
  ],
}

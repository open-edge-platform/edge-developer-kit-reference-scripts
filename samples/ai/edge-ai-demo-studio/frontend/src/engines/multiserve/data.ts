// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'
import type { Service } from '@/payload-types'
import { LOGS_DIR, MODELS_DIR, WORKER_DIR } from '../../lib/constants'
import type { Engine } from '../types'
import { supportedBackends } from './backends'

const MULTISERVE_MODELS_DIR = path.join(MODELS_DIR, 'multiserve')
export const MULTISERVE_REPO_PATH = path.join(WORKER_DIR, 'engine/multiserve')
const MULTISERVE_LOGS_DIR = path.join(LOGS_DIR, 'multiserve')

const getModelsDir = (type?: Service['type']): string => {
  if (!type) {
    return MULTISERVE_MODELS_DIR
  }
  return path.join(MULTISERVE_MODELS_DIR, type)
}

const getLogsDir = (type?: Service['type']): string => {
  if (!type) return MULTISERVE_LOGS_DIR
  return path.join(MULTISERVE_LOGS_DIR, type)
}

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
    'This is a custom that engine that helps to run models on OpenVINO or llama.cpp backend',
  supportedBackends,
  getSubPorts: (port) => [port + 1, port + 2, port + 3, port + 4], //ovms needs +1, llama.cpp needs +2, +3  and +4
  getModelName,
  getLogsDir,
  getModelsDir,
  getLogs: (type) => [
    {
      type: 'api',
      label: 'multiserve',
      target: `/v1/logs?name=${type.replace(/-/g, '_')}`,
    },
  ],
}

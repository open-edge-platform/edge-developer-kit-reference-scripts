// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Workload } from '@/payload-types'
import { LOG_FILE_PATH, MULTISERVE_MODELS_DIR_PATH } from '../constants'
import { ModelList } from '@/types/workload'
import path from 'path'

const isWindows = typeof process !== 'undefined' && process.platform === 'win32'

export const DEFAULT_MULTISERVE_FIELDS = {
  engine: (isWindows ? 'llamacpp' : 'openvino') as Workload['engine'],
  healthCheck: {
    url: '/v1/status',
    responseMapper: {
      'models.default.name':
        "($id := $workload.models.default.quant ? $workload.models.default.name & ':' & $workload.models.default.quant : $workload.models.default.name; $matched := status[repo_id=$id and task=$replace($workload.type, '-', '_')]; $split($matched.repo_id, ':')[0])",
      'models.default.quant':
        "($id := $workload.models.default.quant ? $workload.models.default.name & ':' & $workload.models.default.quant : $workload.models.default.name; $matched := status[repo_id=$id and task=$replace($workload.type, '-', '_')]; $split($matched.repo_id, ':')[1])",
      '($d := $lowercase(models.default.device); $replace($d, /^gpu(\\..*)?$/, "gpu"))':
        "($id := $workload.models.default.quant ? $workload.models.default.name & ':' & $workload.models.default.quant : $workload.models.default.name; $dev := $lowercase(status[repo_id=$id and task=$replace($workload.type, '-', '_')].device); $replace($dev, /^gpu(\\..*)?$/, 'gpu'))",
    },
  },
}

export const KNOWN_QUANTIZATIONS = ['int4', 'int8', 'fp16', 'fp32']

export const MULTISERVE_VERIFIED_MODELS: ModelList = [
  // llama.cpp / GGUF models
  {
    id: 'Qwen/Qwen3-1.7B-GGUF',
    engine: 'llamacpp',
    task: 'text-generation',
    quant: 'Q8_0',
    verified: true,
    source: ['huggingface', 'modelscope'],
  },
  {
    id: 'Qwen/Qwen3-4B-GGUF',
    engine: 'llamacpp',
    task: 'text-generation',
    quant: 'Q8_0',
    verified: true,
    source: ['huggingface', 'modelscope'],
  },
  {
    id: 'Qwen/Qwen3-8B-GGUF',
    engine: 'llamacpp',
    task: 'text-generation',
    quant: 'Q4_K_M',
    verified: true,
    source: ['huggingface', 'modelscope'],
  },
  {
    id: 'Qwen/Qwen3-Embedding-0.6B-GGUF',
    engine: 'llamacpp',
    task: 'embeddings',
    quant: 'Q8_0',
    verified: true,
    source: ['huggingface', 'modelscope'],
  },
  {
    id: 'gpustack/bge-reranker-v2-m3-GGUF',
    engine: 'llamacpp',
    task: 'rerank',
    quant: 'Q8_0',
    verified: true,
    source: ['huggingface', 'modelscope'],
  },
  {
    id: 'ggml-org/Qwen3-VL-2B-Instruct-GGUF',
    engine: 'llamacpp',
    task: 'multimodal',
    quant: 'Q8_0',
    source: ['huggingface', 'modelscope'],
  },
  {
    id: 'unsloth/Qwen2.5-VL-3B-Instruct-GGUF',
    engine: 'llamacpp',
    task: 'multimodal',
    quant: 'Q4_K_M',
    source: ['huggingface', 'modelscope'],
  },
  // OpenVINO models
  {
    id: 'OpenVINO/Qwen3-8B-int4-ov',
    engine: 'openvino',
    task: 'text-generation',
    tool_parser: 'hermes3',
    chat_template: '',
    source: ['huggingface', 'modelscope'],
  },
  {
    id: 'OpenVINO/Qwen3-4B-int8-ov',
    engine: 'openvino',
    task: 'text-generation',
    tool_parser: 'hermes3',
    chat_template: '',
    source: ['huggingface', 'modelscope'],
  },
  {
    id: 'OpenVINO/Phi-4-mini-instruct-int8-ov',
    engine: 'openvino',
    task: 'text-generation',
    tool_parser: 'phi4',
    chat_template:
      'https://raw.githubusercontent.com/openvinotoolkit/model_server/refs/heads/releases/2025/3/extras/chat_template_examples/chat_template_phi4_mini.jinja',
    source: ['huggingface', 'modelscope'],
  },
  {
    id: 'OpenVINO/Qwen3-Embedding-0.6B-int8-ov',
    engine: 'openvino',
    task: 'embeddings',
    source: ['huggingface', 'modelscope'],
  },
  {
    id: 'OpenVINO/bge-reranker-base-int8-ov',
    engine: 'openvino',
    task: 'rerank',
    source: ['huggingface', 'modelscope'],
  },
]

export const getMultiserveModelsDir = (type: Workload['type']) => {
  return path.join(MULTISERVE_MODELS_DIR_PATH, type)
}

export const getMultiserveLogsDir = (type: Workload['type']) => {
  return path.join(LOG_FILE_PATH, 'multiserve', `${type}`)
}

export const getDefaultModelForEngine = (
  engine: string,
  type: 'rerank' | 'embeddings' | 'text-generation',
) => {
  const model = MULTISERVE_VERIFIED_MODELS.find((model) => {
    return model.engine === engine && model.task === type
  })

  const selectedModel = model ?? MULTISERVE_VERIFIED_MODELS[0]
  return {
    name: selectedModel.id,
    source: 'huggingface' as const,
    quant: selectedModel.quant,
    device: 'CPU',
  }
}

export const MULTISERVE_ENGINES = [
  {
    id: 'openvino',
    name: 'OpenVINO Model Server (OVMS)',
    description: 'Intel OpenVINO optimized inference server',
    recommended: !isWindows,
  },
  {
    id: 'llamacpp',
    name: 'llama.cpp',
    description: 'Lightweight C++ inference engine',
    recommended: isWindows,
  },
]

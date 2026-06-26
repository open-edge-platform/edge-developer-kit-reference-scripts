// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { EngineBackend } from '../types'

export const supportedBackends: EngineBackend[] = [
  {
    name: 'OpenVINO',
    value: 'openvino',
    description:
      'OpenVINO is a toolkit for optimizing and deploying AI inference.',
    supportedServices: ['rerank', 'embeddings', 'text-generation'],
    supportedOS: ['windows', 'linux'],
    recommendedOS: 'linux',
    models: {
      'text-generation': [
        {
          name: 'OpenVINO/Qwen3.5-4B-int4-ov',
          device: 'CPU',
          backend: 'openvino',
        },
        {
          name: 'OpenVINO/InternVL2-2B-int4-ov',
          device: 'CPU',
          backend: 'openvino',
          type: 'multimodal',
        },
      ],
      embeddings: [
        {
          name: 'OpenVINO/Qwen3-Embedding-0.6B-int8-ov',
          device: 'CPU',
          backend: 'openvino',
        },
      ],
      rerank: [
        {
          name: 'OpenVINO/bge-reranker-base-int8-ov',
          device: 'CPU',
          backend: 'openvino',
        },
      ],
    },
    supportedDevices: ['cpu', 'gpu', 'npu'],
    healthcheck: {
      url: '/v1/status',
      responseMapper: {
        'models.default.name':
          "($id := $service.models.default.name; $task := $service.models.default.type = 'multimodal' ? 'multimodal' : $replace($service.type, '-', '_'); $matched := status.ovms[repo_id=$id and task=$task]; $matched.repo_id)",
        'models.default.quant': '($service.models.default.quant)',
        '($d := $lowercase(models.default.device); $replace($d, /^gpu(\\..*)?$/, "gpu"))':
          "($id := $service.models.default.name; $task := $service.models.default.type = 'multimodal' ? 'multimodal' : $replace($service.type, '-', '_'); $dev := $lowercase(status.ovms[repo_id=$id and task=$task].device); $replace($dev, /^gpu(\\..*)?$/, 'gpu'))",
      },
    },
  },
  {
    name: 'llama.cpp',
    value: 'llamacpp',
    description:
      'llama.cpp is a C++ implementation of the LLaMA language model.',
    supportedServices: ['embeddings', 'rerank', 'text-generation'],
    supportedOS: ['windows', 'linux'],
    recommendedOS: 'windows',
    supportedDevices: ['cpu', 'gpu'],
    models: {
      'text-generation': [
        {
          name: 'Qwen/Qwen3-1.7B-GGUF',
          quant: 'Q8_0',
          device: 'CPU',
          backend: 'llamacpp',
        },
        {
          name: 'ggml-org/Qwen3-VL-2B-Instruct-GGUF',
          quant: 'Q8_0',
          device: 'CPU',
          backend: 'llamacpp',
          type: 'multimodal',
        },
      ],
      embeddings: [
        {
          name: 'Qwen/Qwen3-Embedding-0.6B-GGUF',
          quant: 'Q8_0',
          device: 'CPU',
          backend: 'llamacpp',
        },
      ],
      rerank: [
        {
          name: 'gpustack/bge-reranker-v2-m3-GGUF',
          quant: 'Q8_0',
          device: 'CPU',
          backend: 'llamacpp',
          type: 'rerank',
        },
      ],
    },
    healthcheck: {
      url: '/v1/status',
      responseMapper: {
        'models.default.name':
          "($id := $service.models.default.quant ? $service.models.default.name & ':' & $service.models.default.quant : $service.models.default.name; $task := $service.models.default.type = 'multimodal' ? 'multimodal' : $replace($service.type, '-', '_'); $matched := status.\"llama.cpp\"[repo_id=$id and task=$task]; $matched.repo_id ? $matched.repo_id : $id)",
        'models.default.quant':
          "($id := $service.models.default.quant ? $service.models.default.name & ':' & $service.models.default.quant : $service.models.default.name; $task := $service.models.default.type = 'multimodal' ? 'multimodal' : $replace($service.type, '-', '_'); $matched := status.\"llama.cpp\"[repo_id=$id and task=$task]; $split($matched.repo_id, ':')[1])",
        '($d := $lowercase(models.default.device); $replace($d, /^gpu(\\..*)?$/, "gpu"))':
          "($id := $service.models.default.quant ? $service.models.default.name & ':' & $service.models.default.quant : $service.models.default.name; $task := $service.models.default.type = 'multimodal' ? 'multimodal' : $replace($service.type, '-', '_'); $dev := $lowercase(status.\"llama.cpp\"[repo_id=$id and task=$task].device); $replace($dev, /^gpu(\\..*)?$/, 'gpu'))",
      },
    },
  },
]

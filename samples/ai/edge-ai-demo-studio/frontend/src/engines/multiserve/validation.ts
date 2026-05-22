// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { KNOWN_QUANTIZATIONS } from './config'
import type { BackendId, ModelUsage, OpenVINOExtraParams } from './types'

const MODEL_NAME_RE = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/
const OPENVINO_SUFFIX_RE = /-(ov|ovz)$/i
const GGUF_RE = /gguf/i
const LLAMACPP_NAME_RE = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+:[a-zA-Z0-9._]+$/
const VLM_PIPELINE_TYPES = new Set(['VLM', 'VLM_CB'])

function isValidNameFormat(name: string): boolean {
  return MODEL_NAME_RE.test(name.split(':')[0])
}

export function isOpenVINONativeModel(name: string): boolean {
  return OPENVINO_SUFFIX_RE.test(name.split(':')[0])
}

function validateOpenVINOModelName(name: string): boolean {
  if (!name) return false
  if (!name?.trim()) return false
  return isValidNameFormat(name)
}

// Validates llama.cpp model name: must contain GGUF and follow org/model:quant format
function validateLlamaCPPModelName(name: string): boolean {
  if (!name?.trim()) return false
  if (!GGUF_RE.test(name)) return false
  return LLAMACPP_NAME_RE.test(name)
}

export function validateModelName(name: string, backend: BackendId): boolean {
  return backend === 'llamacpp'
    ? validateLlamaCPPModelName(name)
    : validateOpenVINOModelName(name)
}

export function isKnownWeightFormat(format: string): boolean {
  return (KNOWN_QUANTIZATIONS as readonly string[]).includes(format)
}

export function inferModelUsage(pipelineType: string): ModelUsage {
  return VLM_PIPELINE_TYPES.has(pipelineType.toUpperCase())
    ? 'multimodal'
    : 'default'
}

export function buildExtraParams(params: OpenVINOExtraParams): string {
  const parts: string[] = []
  if (params.pipelineType && params.pipelineType !== 'AUTO') {
    parts.push(`--pipeline_type ${params.pipelineType}`)
  }
  if (params.weightFormat) {
    parts.push(`--weight-format ${params.weightFormat}`)
  }
  if (params.additionalParams.trim()) {
    parts.push(params.additionalParams.trim())
  }
  return parts.join(' ').trim()
}

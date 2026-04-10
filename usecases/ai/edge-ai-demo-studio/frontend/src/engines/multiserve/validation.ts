// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { KNOWN_QUANTIZATIONS } from './config'
import type { BackendId, ModelUsage, OpenVINOExtraParams } from './types'

// ─── Patterns ─────────────────────────────────────────────────────

/** Standard org/model-name format. */
const MODEL_NAME_RE = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/

/** OpenVINO native model suffix (e.g. model-ov, model-ovz). */
const OPENVINO_SUFFIX_RE = /-(ov|ovz)$/i

/** GGUF somewhere in the name (case-insensitive). */
const GGUF_RE = /gguf/i

/** org/model-name:quantization (quant is required) */
const LLAMACPP_NAME_RE = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+:[a-zA-Z0-9._]+$/

/** Pipeline types that select vision-language (multimodal) inference. */
const VLM_PIPELINE_TYPES = new Set(['VLM', 'VLM_CB'])

// ─── Model Name Validation ────────────────────────────────────────

/** Check whether a name follows the standard `org/model` format. */
function isValidNameFormat(name: string): boolean {
  return MODEL_NAME_RE.test(name.split(':')[0])
}

/**
 * Check if a model name uses OpenVINO native naming convention
 * (ends with `-ov` or `-ovz`), meaning it needs no conversion.
 */
export function isOpenVINONativeModel(name: string): boolean {
  return OPENVINO_SUFFIX_RE.test(name.split(':')[0])
}

/** Validate an OpenVINO model name (`org/model` format). */
function validateOpenVINOModelName(name: string): boolean {
  if (!name) return false
  if (!name?.trim()) return false
  return isValidNameFormat(name)
}

/**
 * Validate a llama.cpp model name.
 * Must contain "GGUF" and follow `org/model:quant` format (quant is required).
 */
function validateLlamaCPPModelName(name: string): boolean {
  if (!name?.trim()) return false
  if (!GGUF_RE.test(name)) return false
  return LLAMACPP_NAME_RE.test(name)
}

/** Validate a model name for the given backend. */
export function validateModelName(name: string, backend: BackendId): boolean {
  return backend === 'llamacpp'
    ? validateLlamaCPPModelName(name)
    : validateOpenVINOModelName(name)
}

// ─── Weight Format ────────────────────────────────────────────────

/** Check if a weight format string is in the known quantization list. */
export function isKnownWeightFormat(format: string): boolean {
  return (KNOWN_QUANTIZATIONS as readonly string[]).includes(format)
}

// ─── Pipeline Type → Model Usage ──────────────────────────────────

/** Infer model usage (default or multimodal) from the OVMS pipeline type. */
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

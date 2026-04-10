// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// ─── API Response Types ───────────────────────────────────────────

export interface MultiserveModel {
  repo_id: string
  task_type: string
  verified: string[]
  downloaded: string[]
  sources: string[]
}

// ─── Backend Configuration Types ──────────────────────────────────

/** Backend identifiers for the multiserve engine. */
export type BackendId = 'openvino' | 'llamacpp'

/** Platform where a model can be sourced from. */
export type ModelSource = 'huggingface' | 'modelscope' | 'custom'

/** Model usage / inference type. */
export type ModelUsage = 'default' | 'multimodal'

/** Structured representation of OpenVINO extra parameters. */
export interface OpenVINOExtraParams {
  pipelineType: string
  weightFormat: string
  additionalParams: string
}

/** Input for validating a complete model configuration. */
export interface ModelConfigInput {
  name: string
  backend: BackendId
  source: ModelSource
  weightFormat?: string
  hasUploadedFile?: boolean
  modelExistsOnDisk?: boolean
}

/** Result of a model configuration validation. */
export interface ValidationResult {
  valid: boolean
  errors: string[]
}

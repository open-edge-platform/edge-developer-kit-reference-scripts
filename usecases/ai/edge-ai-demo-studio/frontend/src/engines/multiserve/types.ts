// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export interface MultiserveModel {
  repo_id: string
  task_type: string
  verified: string[]
  downloaded: string[]
  sources: string[]
}

export type BackendId = 'openvino' | 'llamacpp'

export type ModelSource = 'huggingface' | 'modelscope' | 'custom'
export type ModelUsage = 'default' | 'multimodal'

export interface OpenVINOExtraParams {
  pipelineType: string
  weightFormat: string
  additionalParams: string
}

export interface ModelConfigInput {
  name: string
  backend: BackendId
  source: ModelSource
  weightFormat?: string
  hasUploadedFile?: boolean
  modelExistsOnDisk?: boolean
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

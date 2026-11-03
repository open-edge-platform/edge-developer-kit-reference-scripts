// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ModelSource } from '@/types/common'

/** One row of the engine's model list (`GET /v1/models`, or the disk scan). */
export interface MultiserveModel {
  repo_id: string
  task_type: string
  verified: string[]
  downloaded: string[]
  sources: string[]
}

/** The engine's backends — the multiserve subset of `DeviceBackend`. */
export type BackendId = 'openvino' | 'llamacpp'

/**
 * The llama.cpp build setup.sh installed (`./setup.sh --backend`); the SYCL
 * build's GPUs are oneAPI Level Zero devices.
 */
export type LlamaBuild = 'vulkan' | 'sycl'

export type ListedModel = MultiserveModel & { backend: BackendId }

export type ModelUsage = 'default' | 'multimodal'

export interface OpenVINOExtraParams {
  pipelineType: string
  weightFormat: string
  additionalParams: string
}

/** A model picked in the model manager (a row, a quant of it, or one added by name). */
export interface ModelSelection {
  repoId: string
  backend: BackendId
  taskType: ModelUsage
  /** The llama.cpp quant it runs as (`<repo>:<QUANT>`). */
  quant?: string
  /** Known OpenVINO weight format; fills the panel's field (unset leaves what the user typed). */
  weightFormat?: string
  additionalParams?: string
  source?: ModelSource
}

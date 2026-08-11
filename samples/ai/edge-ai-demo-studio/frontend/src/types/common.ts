// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export type OS = 'windows' | 'linux'
export type Device = 'cpu' | 'gpu' | 'xpu' | 'npu'
export type EngineId = 'multiserve'
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

/** Log entry returned by the multiserve worker API (`/v1/logs`). */
export interface ApiLogEntry {
  timestamp: string
  message: string
  level?: LogLevel
}

/** Response shape returned by the multiserve worker log endpoint. */
export interface ApiLogResponse {
  logs: ApiLogEntry[]
  offset: number
  timestamp: string | null
}

// ─── Shared types used by both engines and services ───────────────

export interface SelectOption {
  value: string
  label: string
}

export type ModelSource = 'huggingface' | 'modelscope'

export type ModelWeight = 'lightweight' | 'heavy'

export interface ModelOption {
  value: string
  label: string
  availableDevices?: string[]
  backend?: DeviceBackend
  gated?: ModelSource[]
  weight?: ModelWeight
}

export type DeviceBackend = 'openvino' | 'pytorch' | 'vulkan' | 'llamacpp'

export interface ServiceConfig {
  availableModels?: ModelOption[]
  availableDevices?: string[]
  availableModelSources?: SelectOption[]
  availableModelTypes?: SelectOption[]
  availablePipelineTypes?: SelectOption[]
  availableWeightFormats?: string[]
  supportsCustomModel?: boolean
}

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

export interface LogSource {
  type: 'service' | 'api'
  label: string
  target: string
}

/** Get the OS display label */
export function getOSLabel(os: OS): string {
  switch (os) {
    case 'linux':
      return 'Linux'
    case 'windows':
      return 'Windows'
  }
}

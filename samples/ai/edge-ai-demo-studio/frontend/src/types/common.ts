// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** A platform services and samples run on. */
export type OS = 'windows' | 'linux'
/** What the host reports (`/api/system-info`): a supported platform or macOS. */
export type HostOS = OS | 'macos'

export function isHostOS(value: unknown): value is HostOS {
  return value === 'windows' || value === 'linux' || value === 'macos'
}
export type Device = 'auto' | 'cpu' | 'gpu' | 'xpu' | 'npu'
export type EngineId = 'multiserve'
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

/** One log line from a worker's `/v1/logs` or from `/api/logs` (a process or engine log file). */
export interface ApiLogEntry {
  timestamp: string
  message?: string | null
  /**
   * A level name (`INFO`, `warning`, …) from a worker API, or the process
   * stream a line was written to (`out`, `info`, `error`) from `/api/logs`.
   */
  level?: string | null
  /** Process stream of worker API entries that carry no level. */
  type?: string | null
}

/** A page of log lines; `offset`/`timestamp` are the cursor of the next read. */
export interface ApiLogResponse {
  logs: ApiLogEntry[]
  offset: number
  timestamp: string | null
}

export interface SelectOption {
  value: string
  label: string
}

/**
 * The registry a model is pulled from. A stored `custom` source (an uploaded
 * model) is not one: services read it as unset.
 */
export type ModelSource = 'huggingface' | 'modelscope'

/** The registries, named as the UI shows them. */
export const MODEL_SOURCE_OPTIONS: readonly {
  value: ModelSource
  label: string
}[] = [
  { value: 'huggingface', label: 'Hugging Face' },
  { value: 'modelscope', label: 'ModelScope' },
]

export function isModelSource(value: unknown): value is ModelSource {
  return value === 'huggingface' || value === 'modelscope'
}

export type ModelWeight = 'lightweight' | 'heavy'

export interface ModelOption {
  value: string
  label: string
  availableDevices?: string[]
  /**
   * Overrides the service's `availableWeightFormats`; a single format when the weights come at a
   * fixed precision, which the Runtime Settings show.
   */
  availableWeightFormats?: string[]
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
  /**
   * Precisions the worker converts its model to on first start: adds a Precision choice under
   * Advanced settings, stored as `models.default.quant`.
   */
  availableWeightFormats?: string[]
  /** The precision an instance converts to when it names none. */
  defaultWeightFormat?: string
  /**
   * Accepts a model id beyond `availableModels`. Unset means no, unless `custom` is among
   * `availableModelSources`: read it through `supportsCustomModels` (`@/services/model-config`).
   */
  supportsCustomModel?: boolean
}

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

/**
 * A log the Logs tab reads: `service` a process log file (`logs/<target>.log`), `engine` the log
 * engine `target` keeps for the instance, `api` a worker's log endpoint (only while it runs).
 */
export interface LogSource {
  type: 'service' | 'engine' | 'api'
  label: string
  target: string
}

const OS_LABELS: Record<HostOS, string> = {
  linux: 'Linux',
  windows: 'Windows',
  macos: 'macOS',
}

/** The display name of a platform or host system. */
export function getOSLabel(os: HostOS): string {
  return OS_LABELS[os] ?? String(os)
}

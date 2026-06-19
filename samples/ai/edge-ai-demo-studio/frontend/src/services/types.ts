// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import type { Service as PayloadService } from '@/payload-types'
import type {
  DeviceBackend,
  EngineId,
  HttpMethod,
  LogSource,
  ModelSource,
  OS,
  ServiceConfig,
} from '@/types/common'

// Re-export shared types so existing imports from '@/services/types' continue to work
export type {
  DeviceBackend,
  EngineId,
  HttpMethod,
  LogLevel,
  LogSource,
  ModelOption,
  ModelSource,
  SelectOption,
  ServiceConfig,
} from '@/types/common'

export type ExecutionMode = 'worker' | 'none' | EngineId
export type ServiceExecution = { mode: ExecutionMode | ExecutionMode[] }

export function getExecutionModes(
  execution: ServiceExecution,
): ExecutionMode[] {
  return Array.isArray(execution.mode) ? execution.mode : [execution.mode]
}

export function hasExecutionMode(
  execution: ServiceExecution,
  target: ExecutionMode,
): boolean {
  return getExecutionModes(execution).includes(target)
}

export interface WorkerConfig {
  buildArgs: (doc: PayloadService) => string[]
  workerSubDir?: string | ((doc: PayloadService) => string)
  modelDirectories?: string[]
  requiresDocker?: boolean
  stopScript?: boolean
}

export type ServiceStatus = 'online' | 'offline' | 'error' | 'starting'

export interface ServiceMetrics {
  latency: string
  throughput: string
  modelSize: string
}

export interface DeviceOption {
  value: string
  label: string
}

// Matches device option value against backend-reported value, handling backend-specific naming
export function isDeviceMatch(
  optionValue: string,
  backendDeviceValue: string,
  backend?: DeviceBackend,
): boolean {
  const strip = (v: string) => v.replace(/[.:]\d+$/i, '').toLowerCase()
  const a = strip(optionValue)
  const b = strip(backendDeviceValue)
  if (a === b) return true
  if (backend === 'pytorch') {
    if ((a === 'gpu' && b === 'xpu') || (a === 'xpu' && b === 'gpu'))
      return true
  }
  return false
}

// Resolves device options for a model, falling back to ServiceConfig.availableDevices
export function getDevicesForModel(
  config: ServiceConfig | undefined,
  modelValue: string,
): string[] {
  const model = config?.availableModels?.find((m) => m.value === modelValue)
  if (model?.availableDevices?.length) return model.availableDevices
  return config?.availableDevices ?? []
}

export function getBackendForModel(
  config: ServiceConfig | undefined,
  modelValue: string,
): DeviceBackend | undefined {
  const model = config?.availableModels?.find((m) => m.value === modelValue)
  return model?.backend
}

export interface ServiceMeta {
  id: PayloadService['type']
  name: string
  description: string
  longDescription: string
  icon: LucideIcon
  port?: number
  reservedPorts?: number[]
  model?: string
  hardware?: string
  framework?: string
  metrics?: ServiceMetrics
  supportedOS: OS[]
  execution: ServiceExecution
  defaultModel?: {
    name: string
    device: string
    backend?: string
    quant?: string
  }
  healthCheck?: PayloadService['healthCheck']
  config?: ServiceConfig
  logSources: LogSource[]
  prerequisiteServices?: PayloadService['type'][]

  metadata?: PayloadService['metadata']

  hidden?: boolean
}

export interface Service extends ServiceMeta {
  status: ServiceStatus
  demo?: ComponentType<{ service: Service }>
  /** Payload CMS record ID — set after DB record is found */
  dbId?: number
  engine?: PayloadService['engine']
  currentModel?: string
  currentDevice?: string
  currentBackend?: DeviceBackend
  currentModelType?: string
  currentQuant?: string
  currentSource?: ModelSource
  metadata?: PayloadService['metadata']
}

export interface ApiParam {
  name: string
  type: string
  required: boolean
  desc: string
}

export interface ApiEndpoint {
  method: HttpMethod
  path: string
  description: string
  params?: ApiParam[]
}

export interface CodeSnippet {
  language: string
  languageCode: string
  code: string
}

export interface CodeSample {
  title: string
  codeSnippets: CodeSnippet[]
}

export interface ServiceDocsData {
  serviceDescription?: string
  overview: string
  endpoints: ApiEndpoint[]
  sampleCodeIntro?: string
  sampleCode: CodeSample[]
  responseExample: string
}

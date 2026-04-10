// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import type { Service as PayloadService } from '@/payload-types'
import type { OS } from '@/types/common'

// ─── Execution Mode ───────────────────────────────────────────────

/**
 * Known engine identifiers. Each corresponds to an engine folder
 * under src/engines/<id>/ with its own data.ts and process-handler.ts.
 *
 * To add a new engine:
 *   1. Add the identifier to this union
 *   2. Create src/engines/<id>/data.ts + process-handler.ts
 *   3. Register the start handler in src/engines/registry.ts
 */
export type EngineId = 'multiserve'

/**
 * How a service is executed at runtime.
 * - "worker": Runs its own Python process (standalone FastAPI).
 *             The frontend spawns and manages the process directly.
 * - Any EngineId: Managed by the corresponding shared inference engine.
 *             The engine handles process lifecycle, model download, and serving.
 *
 * When a service supports multiple engines, pass an array of modes.
 * The runtime mode is resolved from the Payload service document's engine field.
 */
export type ExecutionMode = 'worker' | 'none' | EngineId
export type ServiceExecution = { mode: ExecutionMode | ExecutionMode[] }

/** Normalize execution mode to always return an array. */
export function getExecutionModes(
  execution: ServiceExecution,
): ExecutionMode[] {
  return Array.isArray(execution.mode) ? execution.mode : [execution.mode]
}

/** Check if a service execution includes a specific mode. */
export function hasExecutionMode(
  execution: ServiceExecution,
  target: ExecutionMode,
): boolean {
  return getExecutionModes(execution).includes(target)
}

/**
 * Configuration for worker-based services.
 * Exported alongside `service` in each worker service's data.ts file.
 */
export interface WorkerConfig {
  /** Build CLI arguments from the Payload service document */
  buildArgs: (doc: PayloadService) => string[]
  /**
   * Subdirectory under WORKER_DIR for this worker.
   * Can be a static string or a function for dynamic resolution.
   * Default (when omitted): the service type folder name.
   */
  workerSubDir?: string | ((doc: PayloadService) => string)
  /**
   * Directories under the project root that contain downloaded models for this
   * service. Used by the "Clear Model Cache" feature to delete stale or corrupt
   * model files so the worker re-downloads them on next start.
   */
  modelDirectories?: string[]
}

// ─── Service ──────────────────────────────────────────────────────
export type ServiceStatus = 'online' | 'offline' | 'error' | 'starting'

export interface ServiceMetrics {
  latency: string
  throughput: string
  modelSize: string
}

/** Backend identifier for device detection. Maps to /api/devices/<backend>. */
export type DeviceBackend = 'openvino' | 'pytorch' | 'vulkan'

export interface ModelOption {
  value: string
  label: string
  /** Per-model device overrides (values only — labels are fetched from device APIs at runtime). */
  availableDevices?: string[]
  /** Per-model backend override for device detection. */
  backend?: DeviceBackend
}

export interface DeviceOption {
  value: string
  label: string
}

/**
 * Check if a device option value matches a backend-reported device value.
 * Handles backend-specific naming: PyTorch uses "xpu" for Intel GPUs.
 */
export function isDeviceMatch(
  optionValue: string,
  backendDeviceValue: string,
  backend?: DeviceBackend,
): boolean {
  // Strip optional device index (e.g. "xpu:0" → "xpu", "GPU.1" → "GPU")
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

/**
 * Resolve the device options for a given model value.
 * Checks the model's own `availableDevices` first, then falls back to the
 * top-level `ServiceConfig.availableDevices`.
 */
export function getDevicesForModel(
  config: ServiceConfig | undefined,
  modelValue: string,
): string[] {
  const model = config?.availableModels?.find((m) => m.value === modelValue)
  if (model?.availableDevices?.length) return model.availableDevices
  return config?.availableDevices ?? []
}

/**
 * Resolve the device-detection backend for a given model.
 */
export function getBackendForModel(
  config: ServiceConfig | undefined,
  modelValue: string,
): DeviceBackend | undefined {
  const model = config?.availableModels?.find((m) => m.value === modelValue)
  return model?.backend
}

/** Generic select option for UI dropdowns */
export interface SelectOption {
  value: string
  label: string
}

/**
 * UI configuration for a service — available options shown in the Configure panel.
 * Defined in each service's config.ts and attached to ServiceMeta.config.
 */
export interface ServiceConfig {
  /** Available model presets shown in the model selector / Configure UI */
  availableModels?: ModelOption[]
  /** Available device values (labels are fetched from device APIs at runtime) */
  availableDevices?: string[]
  /** Model source platforms (e.g., Hugging Face, ModelScope, custom upload) */
  availableModelSources?: SelectOption[]
  /** Model type options (e.g., text-generation, multimodal/VLM) */
  availableModelTypes?: SelectOption[]
  /** Pipeline type options for OpenVINO Model Server */
  availablePipelineTypes?: SelectOption[]
  /** Known weight formats for non-OpenVINO model conversion */
  availableWeightFormats?: string[]
  /** Whether the service supports custom (user-provided) models. Defaults to true. */
  supportsCustomModel?: boolean
}

/**
 * Static service metadata defined in each service's data.ts file.
 * Does not include runtime fields that come from the database (e.g. status).
 */
export interface ServiceMeta {
  id: PayloadService['type']
  name: string
  description: string
  longDescription: string
  icon: LucideIcon
  port?: number
  /**
   * The following fields are only used by worker-based services
   * for static display (badges, metrics).
   */
  model?: string
  hardware?: string
  framework?: string
  metrics?: ServiceMetrics
  /** Operating systems this service can run on */
  supportedOS: OS[]
  /** How this service is executed at runtime */
  execution: ServiceExecution
  /**
   * Single default model seeded into the database on first run.
   * - Worker services: import from config.ts
   * - Engine services: falls back to engine backend's first model in ensureServicesExist
   */
  defaultModel?: {
    name: string
    device: string
    backend?: string
    quant?: string
  }
  healthCheck?: PayloadService['healthCheck']
  /**
   * UI configuration: available model presets, devices, etc.
   * Defined in config.ts and imported into data.ts.
   */
  config?: ServiceConfig
  logSources: LogSource[]
  /**
   * IDs of other services that must be running for this service to function.
   * The UI can use this to show dependency warnings or auto-start prerequisites.
   * Each entry should match a service's `id` field (e.g. "embeddings", "rerank").
   */
  prerequisiteServices?: PayloadService['type'][]

  metadata?: PayloadService['metadata']

  /** If true, the service is hidden from the services list and detail pages */
  hidden?: boolean
}

/**
 * Full service object with runtime fields from the database and the demo component.
 * `status` defaults to "offline" and is enriched with live DB data at runtime.
 * DB values (engine, currentModel, currentDevice) override static defaults.
 */
export interface Service extends ServiceMeta {
  status: ServiceStatus
  demo: ComponentType<{ service: Service }>
  /** Payload CMS record ID — set after DB record is found */
  dbId?: number
  /** Engine identifier from DB (e.g. "openvino", "llamacpp", "custom") */
  engine?: string
  /** Currently configured model name from DB (overrides defaultModel.name) */
  currentModel?: string
  /** Currently configured device from DB (overrides defaultModel.device) */
  currentDevice?: string
  /** Currently configured backend from DB (e.g. "openvino", "llamacpp") */
  currentBackend?: string
  /** Currently configured model type from DB (e.g. "multimodal") */
  currentModelType?: string
  /** Currently configured quantization from DB (e.g. "int4", "fp16") */
  currentQuant?: string
  /** Currently configured model source from DB (e.g. "huggingface", "modelscope") */
  currentSource?: string
  /** Arbitrary metadata from DB (e.g. clientIceServerUrl, serverIceServerUrl) */
  metadata?: PayloadService['metadata']
}

// ─── Documentation ────────────────────────────────────────────────
export interface ApiParam {
  name: string
  type: string
  required: boolean
  desc: string
}

export interface ApiEndpoint {
  method: string
  path: string
  description: string
  params?: ApiParam[]
}

export interface CodeSnippet {
  language: string // Display name, e.g. "Python", "cURL"
  languageCode: string // Shiki language key, e.g. "python", "bash"
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

// ─── Logs ─────────────────────────────────────────────────────────
export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

export interface LogSource {
  type: 'service' | 'api'
  /** Display label, e.g. "text-generation service" */
  label: string
  /** For type "service": the service process name. For type "api": the endpoint URL. */
  target: string
}

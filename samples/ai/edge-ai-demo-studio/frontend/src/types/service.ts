// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * A service as the UI sees it: its static `ServiceMeta` joined with its row's live state. Kept apart
 * from `@/services` so engines can name it without importing a service.
 */

import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import type {
  AppliedConfig,
  StartupTelemetry,
} from '@/lib/instances/runtime-fields'
import type { ServiceStatus } from '@/lib/instances/service-status'
import type { Service as PayloadService } from '@/payload-types'
import type {
  DeviceBackend,
  EngineId,
  LogSource,
  ModelSource,
  OS,
  ServiceConfig,
} from './common'

export type ExecutionMode = 'worker' | 'none' | EngineId

/** User-facing wording for one of a service's execution modes. */
export interface ExecutionModeOption {
  mode: ExecutionMode
  label: string
  description?: string
  /**
   * Model to reset to when switched to this mode (names are engine-specific); else the engine's
   * recommended model, or `defaultModel` for `worker`.
   */
  defaultModel?: { name: string; device: string }
}

export type ServiceExecution = {
  mode: ExecutionMode | ExecutionMode[]
  /** Labels for the engine selector of a service with more than one mode. */
  options?: ExecutionModeOption[]
}

export interface DeviceOption {
  value: string
  label: string
}

/** The model a service starts with until its row stores another. */
export interface DefaultModel {
  name: string
  device: string
  backend?: DeviceBackend
  quant?: string
}

export interface ServiceMeta {
  id: PayloadService['type']
  name: string
  description: string
  longDescription: string
  icon: LucideIcon
  /** Fixed ports the worker uses internally (e.g. an embedded OVMS); its own port is allocated. */
  reservedPorts?: number[]
  /** Consecutive ports needed from the allocated base port (default 1); engines derive it. */
  portBlock?: number
  model?: string
  hardware?: string
  framework?: string
  /**
   * Keep a used demo on screen under the lifecycle notice while stopped or failed, so results stay
   * readable; it must disable requests via `useDemoRuntime().available`. Leave unset for camera or
   * microphone demos: unmounting releases their devices.
   */
  keepDemoWhenStopped?: boolean
  /** Renames the Demo tab when it is not a demo (MCP Manager's "Servers"); test id unchanged. */
  demoTab?: { label: string; icon?: LucideIcon }
  supportedOS: OS[]
  execution: ServiceExecution
  defaultModel?: DefaultModel
  /** For a service with no model: what an instance runs (e.g. FAISS or pgvector), in its place. */
  runtimeLabel?: (instance: { metadata?: unknown }) => string
  healthCheck?: PayloadService['healthCheck']
  config?: ServiceConfig
  logSources: LogSource[]
  prerequisiteServices?: PayloadService['type'][]

  metadata?: PayloadService['metadata']

  hidden?: boolean

  /** Allow several instances (DB rows) at once, e.g. GPU and CPU, at `/api/<id>@<instanceId>`. */
  multiInstance?: boolean
  /** Cap on instances per type (falls back to DEFAULT_MAX_INSTANCES). */
  maxInstances?: number
}

export interface Service extends ServiceMeta {
  status: ServiceStatus
  /** Reason for an `error` status, when the app recorded one. */
  statusMessage?: string
  /** When the current start began (epoch ms), while `starting`. */
  startingSince?: number
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
  /**
   * What the running process was started with, plus saved settings it doesn't use yet
   * (`unapplied`); unset while nothing runs. The `current*` fields are what is saved.
   */
  applied?: AppliedConfig | null
  /** The current start's step and progress, or where a failed start stopped and why. */
  startup?: StartupTelemetry

  // Instance identity (set on enriched services)
  /** Instance id of this view, derived from its name at creation; a rename keeps it. */
  instanceId?: string
  /** Display name of this instance ("Text Generation", "CPU fallback", …). */
  label?: string
  /** `type@instanceId` — unset only for a service with no database row. */
  instanceKey?: string
  /** `/api/<instanceKey>` — where this instance's worker is reachable. */
  apiBase?: string
  /** Live port of this instance's row. */
  instancePort?: number
  /** The service's rows in creation order (type-level views only); empty until it is added. */
  instances?: ServiceInstance[]
  /** Whether the user has added this service (it has at least one instance). */
  added?: boolean
  /**
   * Best status across instances (online > starting > error > offline), for overview surfaces;
   * `status` stays the primary instance's (running, else first).
   */
  aggregateStatus?: ServiceStatus
}

/** One instance of a service: a `Service` view bound to a single DB row. */
export interface ServiceInstance extends Service {
  /** Payload CMS record id — every instance is a database row. */
  dbId: number
  instanceId: string
  label: string
  instanceKey: string
  apiBase: string
}

/** The model a service view runs: what its row stores, else its default. */
export interface EffectiveModel {
  name: string
  device: string
  backend?: DeviceBackend
  quant?: string
  /** Only what the row stores: a default model names no registry. */
  source?: ModelSource
}

/**
 * The model a service view runs: its row's stored values, each falling back to `defaultModel`;
 * name and device are '' when neither has one.
 */
export function getEffectiveModel(
  service: Pick<
    Service,
    | 'currentModel'
    | 'currentDevice'
    | 'currentBackend'
    | 'currentQuant'
    | 'currentSource'
    | 'defaultModel'
  >,
): EffectiveModel {
  return {
    name: service.currentModel ?? service.defaultModel?.name ?? '',
    device: service.currentDevice ?? service.defaultModel?.device ?? '',
    backend: service.currentBackend ?? service.defaultModel?.backend,
    quant: service.currentQuant ?? service.defaultModel?.quant,
    source: service.currentSource,
  }
}

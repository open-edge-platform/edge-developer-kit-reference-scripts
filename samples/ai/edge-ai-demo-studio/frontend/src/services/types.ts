// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceStatus } from '@/lib/instances/service-status'
import type { Service as PayloadService } from '@/payload-types'
import type { HttpMethod } from '@/types/common'

export type {
  DeviceOption,
  ExecutionMode,
  ExecutionModeOption,
  Service,
  ServiceExecution,
  ServiceInstance,
  ServiceMeta,
} from '@/types/service'
export type {
  DeviceBackend,
  HttpMethod,
  LogSource,
  ModelOption,
  ModelSource,
  ModelWeight,
  ServiceConfig,
} from '@/types/common'

/** See `WorkerConfig.modelCatalog`. */
export type WorkerModelCatalog =
  'script' | { presetPaths: Record<string, string | string[]> }

export interface WorkerConfig {
  buildArgs: (doc: PayloadService) => string[]
  workerSubDir?: string | ((doc: PayloadService) => string)
  /** What "Clear model cache" removes, relative to the repository root. */
  modelDirectories?: string[]
  /**
   * How the on-disk model catalogue learns which presets are downloaded without starting the
   * worker: `'script'` runs the worker's `list_models.py --models <id…>`; `presetPaths` are
   * repo-relative paths/globs that must each match a non-empty file; omitted: no per-preset state.
   */
  modelCatalog?: WorkerModelCatalog
  requiresDocker?: boolean
  stopScript?: boolean
  /**
   * Whether the worker parses `--instance-id` / `--data-dir` (every worker gets the INSTANCE_* env).
   * Docker suites opt out because their start scripts reject unknown flags.
   */
  acceptsInstanceArgs?: boolean
  /**
   * Row variants the model catalogue resolves a preset's worker directory against. By default the
   * id is substituted as the row's model; a service that picks its worker otherwise (e.g. per
   * backend) returns one variant per worker that can run the id.
   */
  catalogRows?: (doc: PayloadService, modelId: string) => PayloadService[]
}

export type { ServiceStatus } from '@/lib/instances/service-status'
export {
  instancePreference,
  isRunningStatus,
} from '@/lib/instances/service-status'

/** A service type's overview status: the best across its instances, else its one instance's. */
export function getServiceLiveStatus(service: {
  status: ServiceStatus
  aggregateStatus?: ServiceStatus
}): ServiceStatus {
  return service.aggregateStatus ?? service.status
}

export interface ApiParam {
  name: string
  type: string
  required: boolean
  desc: string
  /** Ids of the `ServiceDocsData.backends` that take it; absent: all. */
  backends?: string[]
}

export interface ApiEndpoint {
  method: HttpMethod
  path: string
  description: string
  params?: ApiParam[]
  /** Ids of the `ServiceDocsData.backends` that serve it; absent: all. */
  backends?: string[]
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

/** A backend a service can run on whose API differs from the others'. */
export interface DocsBackend {
  id: string
  /** How the docs name it, e.g. "OEP backend". */
  label: string
}

/**
 * Shown before the API reference: a few steps and one request that works as written against the
 * selected instance. The docs page adds the step that gets the instance running.
 */
export interface DocsQuickStart {
  /** Two or three short steps, in Markdown. */
  steps: string[]
  /** One minimal working request against the instance's URL. */
  request: CodeSnippet
}

/** What a failed request answers, and when. */
export interface DocsErrors {
  /** The error body's shape, in Markdown. */
  intro: string
  cases: { status: number; when: string }[]
}

export interface ServiceDocsData {
  quickStart: DocsQuickStart
  serviceDescription?: string
  overview: string
  /** Optional: a service whose API is not listed endpoint by endpoint. */
  endpoints?: ApiEndpoint[]
  /** The backends some endpoints or parameters are limited to; omitted when all share one API. */
  backends?: DocsBackend[]
  /** The selected instance's backend: one of `backends`, absent with none. */
  activeBackend?: string
  errors?: DocsErrors
  sampleCodeIntro?: string
  sampleCode?: CodeSample[]
  responseExample?: string
}

/** What a service's docs factory (`<service>/docs.ts`) is told. */
export interface DocsFactoryOptions {
  /** The selected instance's API address, or a placeholder without one. */
  host: string
  /** The model to name in requests, qualified as the API expects it. */
  model?: string
  /** The worker's own port, only while it runs (WebSocket endpoints). */
  port?: number
  /**
   * The selected instance's metadata (e.g. `sttBackend`) as its running process started with it,
   * else as saved; absent before the service has an instance.
   */
  metadata?: Record<string, unknown>
}

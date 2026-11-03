// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { BasePayload } from 'payload'
import type { ReactNode } from 'react'
import type { Service } from '@/payload-types'
import type {
  Device,
  DeviceBackend,
  EngineId,
  LogSource,
  OS,
} from '@/types/common'
import type { Service as ServiceView } from '@/types/service'

export interface EngineBackend {
  name: string
  value: DeviceBackend
  description: string
  supportedServices: Service['type'][]
  supportedOS: OS[]
  recommendedOS: OS
  supportedDevices: Device[]
  models: Partial<Record<Service['type'], Service['models']['default'][]>>
  healthcheck: Service['healthCheck']
}

/**
 * An engine as both browser and server read it, exported as `engine` from its folder's `data.ts`.
 * Must stay free of Node/server imports: client code reaches it through `@/engines/registry`.
 */
export interface Engine {
  name: string
  value: EngineId
  description: string
  supportedBackends: EngineBackend[]
  getSubPorts?: (basePort: number) => number[]
  getModelName: (
    modelConfig: Service['models']['default'],
    inference?: boolean,
  ) => string
  getLogs: (type: Service['type'], backend?: DeviceBackend) => LogSource[]
  /** The engine's own health probe, polled besides a backend's `healthcheck`. */
  healthUrl: string
}

/** The server side of an engine, exported from its folder's `server.ts`. */
export interface EngineServer {
  /** Starts the engine for a `services` row and loads its model; a failure sets the row to `error`. */
  start: (service: Service, payload: BasePayload) => Promise<void>
  /** Cancels a start in progress for an instance process name (`type@id`). */
  cancelStart: (processName: string) => void
  /**
   * Whether `start` is still loading the model. The health poller keeps such a row starting even
   * when the backend's check already passes.
   */
  isStarting: (processName: string) => boolean
  /** Where the engine logs for a service type (the engine's own, without one). */
  getLogsDir: (type?: Service['type']) => string
  /**
   * The log an instance's engine source reads (earlier runs' with `previous`), from disk so it
   * stays readable after the engine stopped; null while there is none.
   */
  getLogFile: (
    instance: Pick<Service, 'type' | 'instanceId'>,
    previous: boolean,
  ) => Promise<string | null>
  getModelsDir: (type?: Service['type']) => string
  /** Quick probe before the backend's health check, so a dead engine isn't retried for a minute. */
  isReachable: (port: number) => Promise<boolean>
  /** Why an instance on this engine failed its health checks, for its row. */
  describeUnhealthy: (service: Service, port: number) => Promise<string>
}

/** Props of an engine's Runtime Settings panel (its `components/configure-panel/index.ts`). */
export interface EngineConfigurePanelProps {
  service: ServiceView
  /** Engine tabs of a multi-engine service, first under Advanced settings. */
  engineTabs?: ReactNode
  /** Controlled by a multi-engine service, so the sheet survives the swap to another engine. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

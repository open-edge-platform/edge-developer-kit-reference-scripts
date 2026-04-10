// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Service } from '@/payload-types'
import type { LogSource } from '@/services/types'
import type { Device, OS } from '@/types/common'

export interface EngineBackend {
  name: string
  value: string
  description: string
  supportedServices: Service['type'][]
  supportedOS: OS[]
  recommendedOS: OS
  supportedDevices: Device[]
  models: Partial<Record<Service['type'], Service['models']['default'][]>>
  healthcheck: Service['healthCheck']
}

export interface Engine {
  name: string
  value: string
  description: string
  supportedBackends: EngineBackend[]
  getSubPorts?: (basePort: number) => number[]
  getLogsDir: (type?: Service['type']) => string
  getModelsDir: (type?: Service['type']) => string
  getModelName: (
    modelConfig: Service['models']['default'],
    inference?: boolean,
  ) => string
  getLogs: (type: Service['type'], backend?: string) => LogSource[]
}

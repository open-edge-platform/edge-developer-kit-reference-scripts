// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { engines } from '@/engines/registry'
import type { Service } from '@/services/types'

export function getServiceModelName(
  service: Service,
  inference = false,
): string | undefined {
  const engine = service.engine ? engines[service.engine] : undefined
  if (!engine) return undefined

  const name = service.currentModel ?? service.defaultModel?.name ?? ''
  if (!name) return undefined

  return engine.getModelName(
    {
      name,
      device: service.currentDevice ?? service.defaultModel?.device ?? '',
      backend: service.currentBackend ?? service.defaultModel?.backend,
      quant: service.currentQuant ?? service.defaultModel?.quant,
    },
    inference,
  )
}

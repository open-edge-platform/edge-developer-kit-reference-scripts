// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  type ServiceModelCatalog,
  useServiceModelCatalog,
} from '@/hooks/use-model-catalog'
import type { Service } from '@/services/types'

export interface WorkerModelCatalog {
  /** The raw catalogue answer. */
  catalog: ServiceModelCatalog | undefined
  /** Whether a preset (or other model id) is on disk. */
  isDownloaded: (model: string) => boolean
  /** How many of the service's presets are on disk; unset when not reported. */
  downloadedPresets: number | undefined
  presetCount: number
}

/** Which of a worker's presets are on disk, scanned without starting it; fetched while `active`. */
export function useWorkerModelCatalog(
  service: Service,
  active: boolean,
): WorkerModelCatalog {
  // Force the worker branch: a worker draft may copy a row still on multiserve, whose stored
  // engine the catalogue route would otherwise follow.
  const { data: catalog } = useServiceModelCatalog(
    service.instanceKey ?? service.id,
    { engine: 'worker', enabled: active },
  )
  const models = catalog?.kind === 'worker' ? catalog.models : undefined
  const downloaded = new Set(
    (models ?? []).filter((m) => m.downloaded).map((m) => m.name),
  )
  const presets = service.config?.availableModels ?? []
  return {
    catalog,
    isDownloaded: (model) => downloaded.has(model),
    downloadedPresets: models
      ? presets.filter((m) => downloaded.has(m.value)).length
      : undefined,
    presetCount: presets.length,
  }
}

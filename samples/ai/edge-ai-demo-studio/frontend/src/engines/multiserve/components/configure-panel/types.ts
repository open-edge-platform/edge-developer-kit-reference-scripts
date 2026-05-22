// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { supportedBackends } from '@/engines/multiserve/backends'
import type {
  BackendId,
  ModelSource,
  ModelUsage,
} from '@/engines/multiserve/types'
import type { OS } from '@/types/common'

/** UI-level source tab — extends ModelSource with "preset" for verified models. */
export type SourceTab = ModelSource | 'preset'

export interface ConfigDraft {
  backend: BackendId
  source: SourceTab
  modelName: string
  device: string
  quant: string
  modelType: ModelUsage
  pipelineType: string
  weightFormat: string
  weightFormatAutoFilled: boolean
  additionalParams: string
}

/**
 * Pick the default backend based on the current OS.
 * Prefers the backend whose `recommendedOS` matches, falls back to the first.
 */
function getDefaultBackend(os?: OS): BackendId {
  if (os) {
    const recommended = supportedBackends.find(
      (b) => b.recommendedOS === os && b.supportedOS.includes(os),
    )
    if (recommended) return recommended.value as BackendId
  }
  return (supportedBackends[0]?.value as BackendId) ?? 'openvino'
}

export function buildInitialDraft(
  currentModel: string,
  currentDevice: string,
  currentBackend?: string,
  os?: OS,
  currentQuant?: string,
  currentSource?: string,
): ConfigDraft {
  // For llamacpp the stored name may be "repo:quant" — split to get separate fields
  let modelName = currentModel
  let quant = currentQuant ?? ''
  if (currentBackend === 'llamacpp') {
    const colonIdx = currentModel.lastIndexOf(':')
    if (colonIdx !== -1) {
      modelName = currentModel.slice(0, colonIdx)
      quant = quant || currentModel.slice(colonIdx + 1)
    }
  }

  return {
    backend: (currentBackend as BackendId) || getDefaultBackend(os),
    source: (currentSource as SourceTab) || 'huggingface',
    modelName,
    device: currentDevice,
    quant,
    modelType: 'default',
    pipelineType: 'AUTO',
    weightFormat: '',
    weightFormatAutoFilled: false,
    additionalParams: '',
  }
}

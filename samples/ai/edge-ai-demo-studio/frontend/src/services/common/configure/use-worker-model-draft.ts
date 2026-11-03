// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import { useDraftState } from '@/hooks/use-draft-state'
import type { ModelOption } from '@/services/types'
import type { EffectiveModel } from '@/types/service'

/** Whether the model is one of the presets or an id typed in. */
export type ModelSourceType = 'preset' | 'custom'

/**
 * A worker panel's model drafts (preset or custom id, registry, device), starting at what the
 * instance runs; a model outside the presets opens on Custom where the service allows it.
 */
export function useWorkerModelDraft({
  current,
  presets,
  supportsCustom,
}: {
  current: EffectiveModel
  presets: ModelOption[]
  supportsCustom: boolean
}) {
  const currentSource = current.source ?? 'huggingface'
  const isCustom =
    supportsCustom && !presets.some((m) => m.value === current.name)
  const initialSourceType = isCustom ? 'custom' : 'preset'

  const [sourceType, setSourceType] =
    useState<ModelSourceType>(initialSourceType)
  const [customModel, setCustomModel] = useState(isCustom ? current.name : '')
  // In custom mode the model draft stays on a preset, so the device query
  // keeps a backend to ask; `resolvedModel` reads the custom id instead.
  const {
    draft,
    setDraft,
    reset: resetDraft,
  } = useDraftState({
    model: isCustom ? (presets[0]?.value ?? current.name) : current.name,
    device: current.device,
    source: currentSource,
  })

  const resolvedModel =
    sourceType === 'custom' ? customModel.trim() : draft.model

  return {
    sourceType,
    setSourceType,
    customModel,
    setCustomModel,
    /** The preset (in custom mode, the first one), device and registry. */
    draft,
    setDraft,
    /** The model to save: the custom id in custom mode, else the preset. */
    resolvedModel,
    /** The drafts differ from what the instance runs. */
    changed:
      resolvedModel !== current.name ||
      draft.device.toLowerCase() !== current.device.toLowerCase() ||
      draft.source !== currentSource,
    /** Puts every draft back to what the instance runs. */
    reset: () => {
      setSourceType(initialSourceType)
      setCustomModel(isCustom ? current.name : '')
      resetDraft()
    },
  }
}

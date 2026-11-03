// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { getDefaultBackend, isBackendId } from '@/engines/multiserve/backends'
import { splitModelName } from '@/engines/multiserve/quant-selection'
import type { BackendId, ModelUsage } from '@/engines/multiserve/types'
import type { HostOS, ModelSource } from '@/types/common'
import type { EffectiveModel } from '@/types/service'

export interface ConfigDraft {
  backend: BackendId
  source: ModelSource
  /** The repo; a llama.cpp quant is kept apart in `quant`. */
  modelName: string
  device: string
  /** `device` is the backend's default after a backend switch, not the user's pick. */
  deviceAutoFilled: boolean
  quant: string
  modelType: ModelUsage
  pipelineType: string
  weightFormat: string
  /** `weightFormat` came from the picked model, not from the user. */
  weightFormatAutoFilled: boolean
  /** Conversion options for `ovms --pull` (saved in `params`). */
  additionalParams: string
  /** Extra model-server arguments (`metadata.serverArgs`), as typed. */
  serverArgs: string
}

/** The draft a configure panel starts from: what the instance runs. */
export function buildInitialDraft(
  current: EffectiveModel,
  os?: HostOS,
  serverArgs = '',
): ConfigDraft {
  // A llama.cpp model is stored as `<repo>:<QUANT>`; the draft keeps the
  // quant apart, as the model list picks it.
  const { repoId, quant } =
    current.backend === 'llamacpp'
      ? splitModelName(current.name, current.quant)
      : { repoId: current.name, quant: current.quant }

  return {
    backend: isBackendId(current.backend)
      ? current.backend
      : getDefaultBackend(os),
    source: current.source ?? 'huggingface',
    modelName: repoId,
    device: current.device,
    deviceAutoFilled: false,
    quant: quant ?? '',
    modelType: 'default',
    pipelineType: 'AUTO',
    weightFormat: '',
    weightFormatAutoFilled: false,
    additionalParams: '',
    serverArgs,
  }
}

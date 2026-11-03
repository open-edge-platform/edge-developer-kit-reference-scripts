// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import type { SettingDescriptions } from '@/components/configure/applied-settings'
import { useConfigureDraftHost } from '@/hooks/use-configure-draft'
import { getServiceMetadata } from '@/lib/instances/service-metadata'
import { WorkerConfigurePanel } from '@/services/common/configure/worker-configure-panel'
import type { WorkerConfigurePanelProps } from '@/services/common/configure/worker-configure-panel-props'
import type { Service } from '@/services/types'
import { getEffectiveModel } from '@/types/service'
import {
  getSttBackend,
  getSttServiceConfig,
  isSttModelSupported,
  STT_BACKEND_OPTIONS,
  type SttBackendId,
} from '../config'
import { SttBackendTabs } from './backend-tabs'
import { DenoiseDeviceSection, SAME_AS_MODEL } from './denoise-device-section'

function backendLabel(backend: string): string {
  return STT_BACKEND_OPTIONS.find((o) => o.value === backend)?.label ?? backend
}

const SETTING_DESCRIPTIONS: SettingDescriptions = {
  'metadata.sttBackend': { label: 'Backend', format: backendLabel },
  'metadata.denoiseDevice': {
    label: 'Noise suppression device',
    unset: 'Same as the speech model',
  },
}

/**
 * Starting model draft on a backend other than the saved one: keeps the saved model and source
 * where that backend supports them, else the default model and Hugging Face.
 */
function startModelOn(
  service: Service,
  backend: SttBackendId,
): WorkerConfigurePanelProps['startModel'] {
  const saved = getEffectiveModel(service)
  const sources = (
    getSttServiceConfig(backend).availableModelSources ?? []
  ).map((s) => s.value)
  const keepModel = isSttModelSupported(backend, saved.name)
  const keepSource = !saved.source || sources.includes(saved.source)
  if (keepModel && keepSource) return undefined
  return {
    ...(!keepModel && { name: service.defaultModel?.name }),
    ...(!keepSource && { source: 'huggingface' as const }),
  }
}

/**
 * Worker settings scoped to the drafted backend's models and sources. Save sends backend and model
 * in one request; Cancel restores the saved backend.
 */
export function SttConfigurePanel({ service }: { service: Service }) {
  const [open, setOpen] = useState(false)
  const isDraft = useConfigureDraftHost() !== null
  const saved = getSttBackend(service.metadata)
  // Held only while it differs from the saved backend, so the draft follows saves made elsewhere.
  const [drafted, setDrafted] = useState<SttBackendId | null>(null)
  const backend = drafted ?? saved
  const changed = backend !== saved
  const savedDenoiseDevice =
    getServiceMetadata(service).denoiseDevice || SAME_AS_MODEL
  const [denoiseDevice, setDenoiseDevice] = useState(savedDenoiseDevice)
  const denoiseChanged =
    backend === 'ovms' && denoiseDevice !== savedDenoiseDevice
  const metadata = {
    // A new instance always names its backend; an existing one only when it changes.
    ...((isDraft || changed) && { sttBackend: backend }),
    ...(denoiseChanged && {
      denoiseDevice: denoiseDevice === SAME_AS_MODEL ? null : denoiseDevice,
    }),
  }

  return (
    <WorkerConfigurePanel
      service={{ ...service, config: getSttServiceConfig(backend) }}
      modelScope={backend}
      startModel={changed ? startModelOn(service, backend) : undefined}
      leadingSection={
        <SttBackendTabs
          value={backend}
          onChange={(next) => setDrafted(next === saved ? null : next)}
          isDraft={isDraft}
        />
      }
      statusItems={[{ label: 'Backend', value: backendLabel(saved) }]}
      settingDescriptions={SETTING_DESCRIPTIONS}
      open={open}
      onOpenChange={setOpen}
      extension={{
        changed: changed || denoiseChanged,
        reset: () => {
          setDrafted(null)
          setDenoiseDevice(savedDenoiseDevice)
        },
        config: Object.keys(metadata).length > 0 ? { metadata } : undefined,
      }}
      advanced={
        backend === 'ovms' && (
          <DenoiseDeviceSection
            value={denoiseDevice}
            onChange={setDenoiseDevice}
          />
        )
      }
    />
  )
}

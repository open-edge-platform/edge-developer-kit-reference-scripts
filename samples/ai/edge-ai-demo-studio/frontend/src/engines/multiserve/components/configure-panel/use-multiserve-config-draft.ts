// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import type { ConfigureSaveRequest } from '@/components/configure/service-configure-panel'
import { useSystemInfo } from '@/context/system-info-context'
import { getBackend, isBackendId } from '@/engines/multiserve/backends'
import {
  joinModelName,
  llamaModelName,
} from '@/engines/multiserve/quant-selection'
import type { BackendId, ModelSelection } from '@/engines/multiserve/types'
import { parseServerArgs } from '@/engines/multiserve/server-args'
import {
  buildExtraParams,
  isOpenVINONativeModel,
  validateModelName,
} from '@/engines/multiserve/validation'
import {
  useConfigureDraftHost,
  useDraftPreview,
} from '@/hooks/use-configure-draft'
import { useConfigureSheet } from '@/hooks/use-configure-sheet'
import { useCpuAffinityDraft } from '@/hooks/use-cpu-affinity-draft'
import { type DeviceList, useDeviceListQuery } from '@/hooks/use-devices'
import { useUpdateServiceConfig } from '@/hooks/use-service-config'
import { supportsCpuAffinity } from '@/lib/instances/cpu-affinity'
import { getServiceMetadata } from '@/lib/instances/service-metadata'
import { getEffectiveModel, type Service } from '@/types/service'
import { buildInitialDraft, type ConfigDraft } from './types'

/** A backend switch's device: the SYCL llama.cpp build's first GPU, else the backend's first. */
function defaultDevice(backend: BackendId, list?: DeviceList): string {
  if (backend === 'llamacpp' && list?.build === 'sycl') {
    const gpu = list.options.find((d) => d.value.startsWith('GPU'))
    if (gpu) return gpu.value
  }
  return (getBackend(backend)?.supportedDevices[0] ?? 'cpu').toUpperCase()
}

/** The configure panel's draft and save; opening or closing the sheet resets the draft. */
export function useMultiserveConfigDraft(
  service: Service,
  {
    open,
    onOpenChange,
  }: {
    open?: boolean
    onOpenChange?: (open: boolean) => void
  },
) {
  const { systemInfo } = useSystemInfo()
  const os = systemInfo?.os
  const canPinCpus = supportsCpuAffinity(os)
  const current = getEffectiveModel(service)
  const currentCpuAffinity = getServiceMetadata(service).cpuAffinity ?? ''
  const currentServerArgs = getServiceMetadata(service).serverArgs ?? ''

  const draftHost = useConfigureDraftHost()
  const draftEngine =
    draftHost != null &&
    (service.dbId == null || draftHost.engine !== draftHost.sourceEngine)
  const cpuAffinity = useCpuAffinityDraft(currentCpuAffinity)
  const [draft, setDraft] = useState<ConfigDraft>(() =>
    buildInitialDraft(current, systemInfo?.os, currentServerArgs),
  )
  const updateDraft = (patch: Partial<ConfigDraft>) =>
    setDraft((prev) => ({ ...prev, ...patch }))

  const sheet = useConfigureSheet({
    open,
    onOpenChange,
    reset: () => {
      setDraft(buildInitialDraft(current, systemInfo?.os, currentServerArgs))
      cpuAffinity.reset()
    },
  })
  const {
    mutate: updateConfig,
    isPending: isSaving,
    phase: savePhase,
  } = useUpdateServiceConfig()

  const {
    data: deviceList,
    isLoading: isDevicesLoading,
    isError: isDevicesError,
    refetch: refetchDevices,
  } = useDeviceListQuery(draft.backend)
  const backendDevices = deviceList?.options

  // Once the devices are known, a device a backend switch filled in becomes the default; otherwise
  // adopt the backend's spelling ("gpu" → "GPU"). An unreported device is left as is, so the picker
  // says it is unavailable rather than quietly swapping in another.
  const [normalizedDevices, setNormalizedDevices] = useState(deviceList)
  if (deviceList !== normalizedDevices) {
    setNormalizedDevices(deviceList)
    const device = draft.deviceAutoFilled
      ? defaultDevice(draft.backend, deviceList)
      : deviceList?.options.find(
          (d) => d.value.toLowerCase() === draft.device.toLowerCase(),
        )?.value
    if (device != null && device !== draft.device) updateDraft({ device })
  }

  const showOpenVINOOptions =
    draft.backend === 'openvino' && draft.modelName.trim() !== ''

  const needsWeightFormat =
    showOpenVINOOptions &&
    validateModelName(draft.modelName, 'openvino') &&
    !isOpenVINONativeModel(draft.modelName)

  const serverArgs = draft.serverArgs.trim()
  const serverArgsChanged = serverArgs !== currentServerArgs.trim()

  // A model that needs converting cannot start without its weight format.
  const isValid =
    draft.modelName.trim().length > 0 &&
    (!needsWeightFormat || draft.weightFormat.trim().length > 0) &&
    parseServerArgs(serverArgs, draft.backend).ok &&
    cpuAffinity.valid

  // A llama.cpp model is saved — and compared — as `<repo>:<QUANT>`.
  const storedName =
    current.backend === 'llamacpp'
      ? llamaModelName(current.name, current.quant)
      : current.name
  const draftName =
    draft.backend === 'llamacpp'
      ? joinModelName(draft.modelName, draft.quant)
      : draft.modelName

  // Fields the row view doesn't carry (pipeline, weight format, params, model type) start from
  // defaults and count as changed when they differ: Save sends them either way.
  const initial = buildInitialDraft(current, os)
  const isDirty =
    sheet.open &&
    (draftName !== storedName ||
      draft.device.toLowerCase() !== current.device.toLowerCase() ||
      (draft.backend !== 'llamacpp' && draft.quant !== (current.quant ?? '')) ||
      (current.backend !== undefined && draft.backend !== current.backend) ||
      draft.source !== initial.source ||
      draft.pipelineType !== initial.pipelineType ||
      draft.weightFormat !== initial.weightFormat ||
      draft.additionalParams !== initial.additionalParams ||
      draft.modelType !== initial.modelType ||
      serverArgsChanged ||
      cpuAffinity.changed)

  const handleBackendChange = (value: string) => {
    if (!isBackendId(value) || value === draft.backend) return
    updateDraft({
      backend: value,
      device: defaultDevice(value),
      deviceAutoFilled: true,
      modelName: '',
      source: 'huggingface',
      quant: '',
      pipelineType: 'AUTO',
      weightFormat: '',
      weightFormatAutoFilled: false,
      additionalParams: '',
      // Flags of one server mean nothing to the other.
      serverArgs: '',
      modelType: 'default',
    })
  }

  const handleSelectModel = (selection: ModelSelection) =>
    setDraft((prev) => {
      // A known weight format fills the field in; one filled in for the
      // previous pick does not carry over, one the user typed does.
      const filled = selection.weightFormat != null
      return {
        ...prev,
        modelName: selection.repoId,
        backend: selection.backend,
        modelType: selection.taskType,
        quant: selection.quant ?? '',
        weightFormat: filled
          ? (selection.weightFormat ?? '')
          : prev.weightFormatAutoFilled
            ? ''
            : prev.weightFormat,
        weightFormatAutoFilled: filled,
        additionalParams: selection.additionalParams ?? prev.additionalParams,
        ...(selection.source != null && { source: selection.source }),
      }
    })

  const handleSave = (request?: ConfigureSaveRequest) => {
    if (!isValid) return
    const params =
      draft.backend === 'openvino'
        ? buildExtraParams({
            pipelineType: draft.pipelineType,
            weightFormat: needsWeightFormat ? draft.weightFormat : '',
            additionalParams: draft.additionalParams,
          })
        : undefined
    const metadata = {
      ...(cpuAffinity.changed && { cpuAffinity: cpuAffinity.normalized }),
      // null clears the key.
      ...(serverArgsChanged && { serverArgs: serverArgs || null }),
    }

    updateConfig(
      {
        serviceId: service.dbId,
        serviceType: service.id,
        restart: request?.restart,
        config: {
          // llama.cpp: the quant is part of the name its health check matches.
          name: draftName,
          device: draft.device,
          backend: draft.backend,
          source: draft.source,
          ...(draft.modelType !== 'default' && { type: draft.modelType }),
          ...(draft.backend !== 'llamacpp' &&
            draft.quant && { quant: draft.quant }),
          ...(params && { params }),
          ...(Object.keys(metadata).length > 0 && { metadata }),
        },
      },
      { onSuccess: sheet.close },
    )
  }

  useDraftPreview(draft.modelName.trim() || undefined, draft.device)

  return {
    os,
    canPinCpus,
    current,
    currentCpuAffinity,
    draft,
    updateDraft,
    draftEngine,
    cpuAffinity,
    sheet,
    isSaving,
    savePhase,
    backendDevices,
    isDevicesLoading,
    isDevicesError,
    refetchDevices,
    showOpenVINOOptions,
    needsWeightFormat,
    isValid,
    isDirty,
    handleBackendChange,
    handleSelectModel,
    handleSave,
  }
}

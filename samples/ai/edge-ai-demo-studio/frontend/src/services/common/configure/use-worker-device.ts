// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { resolveDeviceOptions, useDevicesQuery } from '@/hooks/use-devices'
import {
  getBackendForModel,
  getDevicesForModel,
  isDeviceMatch,
} from '@/services/model-config'
import type { DeviceOption, ServiceConfig } from '@/services/types'

export interface WorkerDevices {
  /** The devices the drafted model can run on here. */
  options: DeviceOption[]
  /** The drafted device, named as its option is (else as drafted). */
  device: string
  isLoading: boolean
  isError: boolean
  /** Asks the model's backend for its devices again. */
  retry: () => void
}

/** Devices the drafted model can run on, and the drafted device matched to one (`GPU.0` ≈ `gpu`). */
export function useWorkerDevice(
  config: ServiceConfig | undefined,
  model: string,
  draftDevice: string,
): WorkerDevices {
  const backend = getBackendForModel(config, model)
  const {
    data: backendDevices,
    isLoading,
    isError,
    refetch,
  } = useDevicesQuery(backend)
  const options = resolveDeviceOptions(
    getDevicesForModel(config, model),
    backendDevices,
    backend,
  )
  const device =
    (
      options.find(
        (d) => d.value.toLowerCase() === draftDevice.toLowerCase(),
      ) ?? options.find((d) => isDeviceMatch(draftDevice, d.value, backend))
    )?.value ?? draftDevice

  return { options, device, isLoading, isError, retry: () => void refetch() }
}

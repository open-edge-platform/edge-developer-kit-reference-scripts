// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query'
import type { LlamaBuild } from '@/engines/multiserve/types'
import { fetchJson } from '@/lib/browser/fetch-json'
import type { DeviceBackend, DeviceOption } from '@/services/types'
import { isDeviceMatch } from '@/services/model-config'

interface DeviceResponse {
  devices: { id: string; name: string }[]
  /** llama.cpp only: the build that listed the devices. */
  build?: LlamaBuild
}

export interface DeviceList {
  options: DeviceOption[]
  build?: LlamaBuild
}

const BACKEND_DEVICE_ROUTES: Record<string, string> = {
  openvino: '/api/devices/openvino',
  llamacpp: '/api/devices/vulkan',
  pytorch: '/api/devices/pytorch',
}

async function fetchDevices(backend: string): Promise<DeviceList> {
  const route = BACKEND_DEVICE_ROUTES[backend]
  if (!route) return { options: [] }

  const data = await fetchJson<DeviceResponse>(route, {
    errorMessage: `Failed to fetch ${backend} devices`,
  })
  return {
    options: data.devices.map((d) => ({
      value: d.id,
      label: d.name,
    })),
    build: data.build,
  }
}

function selectOptions(list: DeviceList): DeviceOption[] {
  return list.options
}

function devicesQuery(backend: string | undefined) {
  return {
    queryKey: ['devices', backend],
    queryFn: () => {
      if (!backend) throw new Error('No backend specified')
      return fetchDevices(backend)
    },
    enabled: !!backend && !!BACKEND_DEVICE_ROUTES[backend],
    staleTime: 5 * 60 * 1000,
    retry: 1,
  }
}

export function useDevicesQuery(backend: string | undefined) {
  return useQuery({ ...devicesQuery(backend), select: selectOptions })
}

/** `useDevicesQuery` with the llama.cpp build that listed the devices. */
export function useDeviceListQuery(backend: string | undefined) {
  return useQuery(devicesQuery(backend))
}

/**
 * Backend-reported devices the service supports. A backend this app cannot query lists the declared
 * devices as-is; a queryable one lists nothing until its answer arrives.
 */
export function resolveDeviceOptions(
  supportedDevices: string[],
  backendDevices: DeviceOption[] | undefined,
  backend: DeviceBackend | undefined,
): DeviceOption[] {
  if (!backend || !BACKEND_DEVICE_ROUTES[backend]) {
    return supportedDevices.map((d) => ({ value: d, label: d }))
  }
  if (!backendDevices) {
    return []
  }

  return backendDevices.filter((bd) =>
    supportedDevices.some((sd) => isDeviceMatch(sd, bd.value, backend)),
  )
}

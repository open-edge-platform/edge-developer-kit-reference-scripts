// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query'
import type { DeviceOption } from '@/services/types'
import { type DeviceBackend, isDeviceMatch } from '@/services/types'

interface DeviceResponse {
  devices: { id: string; name: string }[]
}

const BACKEND_DEVICE_ROUTES: Record<string, string> = {
  openvino: '/api/devices/openvino',
  llamacpp: '/api/devices/vulkan',
  pytorch: '/api/devices/pytorch',
}

async function fetchDevices(backend: string): Promise<DeviceOption[]> {
  const route = BACKEND_DEVICE_ROUTES[backend]
  if (!route) return []

  const res = await fetch(route)
  if (!res.ok) {
    throw new Error(`Failed to fetch ${backend} devices: ${res.status}`)
  }

  const data: DeviceResponse = await res.json()
  return data.devices.map((d) => ({
    value: d.id,
    label: d.name,
  }))
}

export function useDevicesQuery(backend: string | undefined) {
  return useQuery({
    queryKey: ['devices', backend],
    queryFn: () => {
      if (!backend) throw new Error('No backend specified')
      return fetchDevices(backend)
    },
    enabled: !!backend && !!BACKEND_DEVICE_ROUTES[backend],
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
}

export function resolveDeviceOptions(
  supportedDevices: string[],
  backendDevices: DeviceOption[] | undefined,
  backend: DeviceBackend | undefined,
): DeviceOption[] {
  if (!backendDevices) {
    return []
  }

  return backendDevices.filter((bd) =>
    supportedDevices.some((sd) => isDeviceMatch(sd, bd.value, backend)),
  )
}

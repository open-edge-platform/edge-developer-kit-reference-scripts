// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query'
import type { AvailableDevice, DevicesResponse } from '../components/types'

const FALLBACK_DEVICES: AvailableDevice[] = [
  {
    name: 'CPU',
    full_name: 'CPU — worker offline',
    type: 'CPU',
    supported: true,
  },
]

async function fetchDevicesFn(): Promise<DevicesResponse> {
  const res = await fetch('/api/geti-classifier/devices')
  if (!res.ok) throw new Error(`Worker returned ${res.status}`)
  return res.json() as Promise<DevicesResponse>
}

function useDevices() {
  return useQuery({
    queryKey: ['geti-classifier', 'devices'],
    queryFn: fetchDevicesFn,
    retry: false,
    // Devices don't change often; skip refetch on tab focus
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  })
}

export function useAvailableDevices() {
  const query = useDevices()

  const availableDevices: AvailableDevice[] =
    query.data?.available_devices.filter((d) => d.supported) ??
    (query.isError ? FALLBACK_DEVICES : [])

  const currentDevice = query.data?.current_device ?? 'CPU'

  return {
    availableDevices,
    currentDevice,
    isLoading: query.isLoading,
    isError: query.isError,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  }
}

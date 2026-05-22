// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query'
import type { AvailableDevice, DevicesResponse } from '../components/types'

// Shown when the worker is unreachable so the UI never renders empty
const FALLBACK_DEVICES: AvailableDevice[] = [
  {
    name: 'CPU',
    full_name: 'CPU — worker offline',
    type: 'CPU',
    supported: true,
  },
  {
    name: 'GPU',
    full_name: 'GPU — worker offline',
    type: 'GPU',
    supported: true,
  },
  {
    name: 'NPU',
    full_name: 'NPU — worker offline',
    type: 'NPU',
    supported: true,
  },
]

async function fetchDevicesFn(): Promise<DevicesResponse> {
  const res = await fetch('/api/geti-classifier/devices')
  if (!res.ok) throw new Error(`Worker returned ${res.status}`)
  return res.json() as Promise<DevicesResponse>
}

/**
 * Raw react-query hook — use `useAvailableDevices` in components instead.
 */
export function useDevices() {
  return useQuery({
    queryKey: ['geti-classifier', 'devices'],
    queryFn: fetchDevicesFn,
    retry: false,
    // Devices don't change often; skip refetch on tab focus
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  })
}

/**
 * Convenience wrapper that returns a flat, component-friendly shape.
 * Falls back to CPU/GPU/NPU stubs when the worker is offline.
 */
export function useAvailableDevices() {
  const query = useDevices()

  const availableDevices: AvailableDevice[] =
    query.data?.available_devices.filter((d) => d.supported) ??
    (query.isError ? FALLBACK_DEVICES : [])

  // Default to GPU when the worker hasn't responded yet
  const currentDevice = query.data?.current_device ?? 'GPU'

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

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query'
import { requireApiBase } from '@/lib/browser/api-base'
import { type AvailableDevice, fetchDevices, SERVICE_NAME } from '../lib/api'

const FALLBACK_DEVICES: AvailableDevice[] = [
  {
    name: 'AUTO',
    full_name: 'AUTO — worker offline',
    type: 'AUTO',
    supported: true,
  },
]

/** The worker's devices and the one in use; `AUTO` until it says, and alone without the worker. */
export function useAvailableDevices(apiBase: string | undefined) {
  const query = useQuery({
    queryKey: ['geti-classifier', 'devices', apiBase],
    queryFn: () => {
      requireApiBase(apiBase, SERVICE_NAME)
      return fetchDevices(apiBase)
    },
    enabled: Boolean(apiBase),
    retry: false,
    // Devices don't change often; skip refetch on tab focus
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  })

  return {
    availableDevices:
      query.data?.available_devices.filter((d) => d.supported) ??
      (query.isError || !apiBase ? FALLBACK_DEVICES : []),
    currentDevice: query.data?.current_device ?? 'AUTO',
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  }
}

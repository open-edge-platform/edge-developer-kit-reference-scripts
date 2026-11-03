// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/browser/fetch-json'
import { type HostOS, isHostOS } from '@/types/common'

export interface SystemInfo {
  /** Host OS as the server reports it (macOS included). */
  os: HostOS
  /** Device families (`gpu`) and specific ids (`GPU.1`, `xpu:0`). */
  devices: string[]
  /** Logical CPUs on the host. */
  cpuCount: number
  pCoreIds?: number[]
  eCoreIds?: number[]
}

const SYSTEM_INFO_QUERY_KEY = ['system-info'] as const

function toNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: number[] = []
  for (const item of value) {
    if (typeof item === 'number' && Number.isFinite(item)) out.push(item)
  }
  return out.length > 0 ? out.sort((a, b) => a - b) : undefined
}

async function fetchSystemInfo(): Promise<SystemInfo> {
  const data = await fetchJson<Record<string, unknown>>('/api/system-info', {
    errorMessage: 'Failed to fetch system info',
  })
  return {
    // The route only reports these three; anything else is treated as Linux.
    os: isHostOS(data.os) ? data.os : 'linux',
    devices: Array.isArray(data.devices)
      ? data.devices.filter((d): d is string => typeof d === 'string')
      : ['cpu'],
    cpuCount: typeof data.cpuCount === 'number' ? data.cpuCount : 0,
    pCoreIds: toNumberArray(data.pCoreIds),
    eCoreIds: toNumberArray(data.eCoreIds),
  }
}

/** System info (OS, devices, cores), fetched once and cached. */
export function useSystemInfoQuery() {
  const query = useQuery({
    queryKey: SYSTEM_INFO_QUERY_KEY,
    queryFn: fetchSystemInfo,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  })

  return {
    systemInfo: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  }
}

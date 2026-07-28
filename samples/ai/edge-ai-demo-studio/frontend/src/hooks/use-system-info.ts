// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query'
import type { OS } from '@/types/common'

export interface SystemInfo {
  os: OS
  /** Available device identifiers — includes both families (e.g. 'gpu') and specific IDs (e.g. 'GPU.1', 'xpu:0') */
  devices: string[]
  /** Total number of logical CPUs reported by the host (os.cpus().length). */
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
  const res = await fetch('/api/system-info')
  if (!res.ok) {
    throw new Error(`Failed to fetch system info: ${res.status}`)
  }
  const data = await res.json()
  return {
    os: data.os as OS,
    devices: (data.devices as string[]) ?? ['cpu'],
    cpuCount: typeof data.cpuCount === 'number' ? data.cpuCount : 0,
    pCoreIds: toNumberArray(data.pCoreIds),
    eCoreIds: toNumberArray(data.eCoreIds),
  }
}

/**
 * Fetches system information (OS, devices) once and caches it.
 */
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
  }
}

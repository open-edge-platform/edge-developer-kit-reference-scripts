// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query'
import type { OS } from '@/types/common'

export interface SystemInfo {
  os: OS
}

const SYSTEM_INFO_QUERY_KEY = ['system-info'] as const

async function fetchSystemInfo(): Promise<SystemInfo> {
  const res = await fetch('/api/system-info')
  if (!res.ok) {
    throw new Error(`Failed to fetch system info: ${res.status}`)
  }
  const data = await res.json()
  return {
    os: data.os as OS,
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

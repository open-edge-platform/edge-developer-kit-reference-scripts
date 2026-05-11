// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query'

const POLL_INTERVAL_MS = 10000

export interface SystemMonitoringNpu {
  id: string
  device: string
  utilizationPercent: number | null
  memoryUtilizationPercent: number | null
  source: 'windows-device-detection' | 'linux-npu-top' | 'unavailable'
}

export interface SystemMonitoringGpu {
  id: string
  device: string
  vendor: string | null
  busaddr: string | null
  utilizationPercent: number | null
  memoryUsedMiB: number | null
  memoryTotalMiB: number | null
  memoryUtilizationPercent: number | null
  source: 'xpu-smi' | 'unavailable'
}

export interface SystemMonitoringOverview {
  timestamp: string
  cpu: {
    usagePercent: number
    cores: number
    physicalCores: number
    modelName: string | null
  }
  memory: {
    totalBytes: number
    usedBytes: number
    freeBytes: number
    usagePercent: number
  }
  gpus: SystemMonitoringGpu[]
  npus: SystemMonitoringNpu[]
  xpuSmiAvailable: boolean
  npuAvailable: boolean
  history: {
    cpuUsagePercent: number[]
    memoryUsagePercent: number[]
    gpuUsagePercentByDevice: Record<string, number[]>
    gpuMemoryUsagePercentByDevice: Record<string, number[]>
    npuUsagePercentByDevice: Record<string, number[]>
    npuMemoryUsagePercentByDevice: Record<string, number[]>
  }
}

export const useSystemMonitoringOverview = () => {
  return useQuery({
    queryKey: ['systemMonitoring', 'overview'],
    queryFn: async (): Promise<SystemMonitoringOverview> => {
      const url = new URL('/api/system-monitoring', window.location.origin)
      url.searchParams.set('metric', 'overview')
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error('Network response was not ok')
      }
      return response.json() as Promise<SystemMonitoringOverview>
    },
    refetchInterval: POLL_INTERVAL_MS,
    retry: (failureCount: number): boolean => failureCount < 3,
  })
}

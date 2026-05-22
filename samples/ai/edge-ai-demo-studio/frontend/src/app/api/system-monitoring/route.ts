// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { buildOverviewPayload } from '@/lib/system-monitoring'

export const runtime = 'nodejs'

type MonitoringMetric = 'overview' | 'cpu' | 'memory' | 'gpu' | 'gpus' | 'npu'

const isMonitoringMetric = (value: string | null): value is MonitoringMetric =>
  value === 'overview' ||
  value === 'cpu' ||
  value === 'memory' ||
  value === 'gpu' ||
  value === 'gpus' ||
  value === 'npu'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const metricParam = searchParams.get('metric') ?? 'overview'

  if (!isMonitoringMetric(metricParam)) {
    return NextResponse.json(
      {
        error:
          "Invalid metric. Supported values: 'overview', 'cpu', 'memory', 'gpu', 'gpus', 'npu'.",
      },
      { status: 400 },
    )
  }

  try {
    const overview = await buildOverviewPayload()

    if (metricParam === 'cpu') {
      return NextResponse.json({
        timestamp: overview.timestamp,
        cpu: overview.cpu,
        history: { cpuUsagePercent: overview.history.cpuUsagePercent },
      })
    }

    if (metricParam === 'memory') {
      return NextResponse.json({
        timestamp: overview.timestamp,
        memory: overview.memory,
        history: { memoryUsagePercent: overview.history.memoryUsagePercent },
      })
    }

    if (metricParam === 'gpu' || metricParam === 'gpus') {
      return NextResponse.json({
        timestamp: overview.timestamp,
        gpus: overview.gpus,
        xpuSmiAvailable: overview.xpuSmiAvailable,
        history: {
          gpuUsagePercentByDevice: overview.history.gpuUsagePercentByDevice,
          gpuMemoryUsagePercentByDevice:
            overview.history.gpuMemoryUsagePercentByDevice,
        },
      })
    }

    if (metricParam === 'npu') {
      return NextResponse.json({
        timestamp: overview.timestamp,
        npus: overview.npus,
        npuAvailable: overview.npuAvailable,
        history: {
          npuUsagePercentByDevice: overview.history.npuUsagePercentByDevice,
          npuMemoryUsagePercentByDevice:
            overview.history.npuMemoryUsagePercentByDevice,
        },
      })
    }

    return NextResponse.json(overview)
  } catch (error) {
    logger.error('Failed to read system monitoring metrics:', error)
    return NextResponse.json(
      { error: 'Failed to fetch system monitoring metrics' },
      { status: 500 },
    )
  }
}

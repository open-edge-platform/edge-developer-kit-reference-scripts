// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from 'next/server'
import os from 'os'

interface CpuTimes {
  user: number
  nice: number
  sys: number
  idle: number
  irq: number
}

interface CpuUsage {
  idle: number
  total: number
}

function calculateCpuUsage(): CpuUsage {
  const cpus = os.cpus()

  let totalIdle = 0
  let totalTick = 0

  cpus.forEach((core) => {
    const times: CpuTimes = core.times
    for (const type in times) {
      totalTick += times[type as keyof CpuTimes]
    }
    totalIdle += times.idle
  })

  return { idle: totalIdle / cpus.length, total: totalTick / cpus.length }
}

export async function GET() {
  const startMeasure = calculateCpuUsage()

  // Wait for a short period to measure CPU usage
  await new Promise((resolve) =>
    setTimeout(() => {
      resolve(null)
    }, 1000),
  )

  const endMeasure = calculateCpuUsage()
  const idleDifference = endMeasure.idle - startMeasure.idle
  const totalDifference = endMeasure.total - startMeasure.total
  const cpuUsage = 1 - idleDifference / totalDifference

  return NextResponse.json({ cpuUsage: cpuUsage * 100 })
}

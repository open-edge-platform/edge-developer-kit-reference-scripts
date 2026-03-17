// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from 'next/server'
import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import os from 'os'
import path from 'path'
import { logger } from '@/utils/logger'

interface GpuData {
  device: string
  busaddr: string | null
  name?: string
}

interface DeviceLevelMetric {
  metrics_type: string
  avg?: number
  value?: number
}

interface GpuMetrics {
  compute_usage: number | null
  power: number | null
  frequency: number | null
  memory_used: number | null
  memory_utilization: number | null
  media_engine_frequency: number | null
  [key: string]: number | null
}

function isValidBusAddress(busaddr: string | null): boolean {
  if (!busaddr || typeof busaddr !== 'string') return false
  return /^([0-9a-fA-F]{4}):([0-9a-fA-F]{2}):([0-9a-fA-F]{2})\.[0-9]$/.test(
    busaddr,
  )
}

const isWindows = os.platform() === 'win32'
const xpusmiCommand = isWindows
  ? path.join(process.cwd(), '..', 'thirdparty', 'xpu-smi', 'xpu-smi.exe')
  : 'xpu-smi'

async function getDiscoveredGpus(): Promise<GpuData[]> {
  return new Promise((resolve) => {
    const spawnedProcess = spawn(xpusmiCommand, ['discovery', '-j'])
    let stdout = ''
    let stderr = ''

    spawnedProcess.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    spawnedProcess.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    spawnedProcess.on('close', (code) => {
      if (code !== 0) {
        logger.error('xpi-smi discovery failed:', stderr)
        resolve([])
        return
      }
      try {
        const data = JSON.parse(stdout)
        const deviceList = data.device_list || []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gpus = deviceList.map((d: any) => ({
          device: d.device_id.toString(),
          busaddr: d.pci_bdf_address,
          name: d.device_name,
        }))
        resolve(gpus)
      } catch (e) {
        logger.error('Failed to parse discovery output:', e)
        resolve([])
      }
    })
  })
}

export async function GET() {
  try {
    const gpus = await getDiscoveredGpus()
    return NextResponse.json({ gpus })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

export async function POST(req: Request) {
  try {
    const res = await req.json()

    let gpuData: GpuData[] = []
    if (res.gpus && Array.isArray(res.gpus)) {
      gpuData = res.gpus
    }

    // If bus addresses are missing, try to discover them
    const needsDiscovery = gpuData.some((g) => !g.busaddr)
    let discoveredGpus: GpuData[] = []
    if (needsDiscovery) {
      discoveredGpus = await getDiscoveredGpus()
    }

    const values = await Promise.all(
      gpuData.map(async (gpu) => {
        let busaddr = gpu.busaddr
        if (!busaddr && needsDiscovery) {
          const found = discoveredGpus.find((d) => d.device === gpu.device)
          if (found) busaddr = found.busaddr
        }

        if (busaddr && isValidBusAddress(busaddr)) {
          const spawnedProcess = spawn(xpusmiCommand, [
            'stats',
            '-d',
            busaddr,
            '-j',
          ])
          return getGpuMetricsInternal(spawnedProcess).then((metrics) => ({
            device: gpu.device,
            busaddr: busaddr,
            ...metrics,
          }))
        } else {
          return Promise.resolve({
            device: gpu.device,
            busaddr: busaddr || null,
            compute_usage: null,
            power: null,
            frequency: null,
            memory_used: null,
            memory_utilization: null,
            media_engine_frequency: null,
            error: 'Invalid or missing bus address',
          })
        }
      }),
    )
    return NextResponse.json({
      gpuUtilizations: values.filter((v) => v.compute_usage !== null),
    })
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'Failed to do something exceptional'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

function getGpuMetricsInternal(
  spawnedProcess: ChildProcessWithoutNullStreams,
): Promise<GpuMetrics> {
  return new Promise((resolve, reject) => {
    // Kill the process after a timeout to prevent hanging if no output
    const timeout = setTimeout(() => {
      spawnedProcess.kill()
      resolve({
        compute_usage: null,
        power: null,
        frequency: null,
        memory_used: null,
        memory_utilization: null,
        media_engine_frequency: null,
      })
    }, 2000)

    spawnedProcess.stderr.on('data', () => {
      clearTimeout(timeout)
      resolve({
        compute_usage: null,
        power: null,
        frequency: null,
        memory_used: null,
        memory_utilization: null,
        media_engine_frequency: null,
      })
      spawnedProcess.kill()
    })

    spawnedProcess.stdout.on('data', (data) => {
      try {
        clearTimeout(timeout)
        const jsonData = JSON.parse(data.toString())
        const metrics: GpuMetrics = {
          compute_usage: null,
          power: null,
          frequency: null,
          memory_used: null,
          memory_utilization: null,
          media_engine_frequency: null,
        }

        if (jsonData.device_level && Array.isArray(jsonData.device_level)) {
          // 1. Map all raw metrics dynamically
          jsonData.device_level.forEach((m: DeviceLevelMetric) => {
            // Prefer 'value', fallback to 'avg' (legacy/compatibility)
            const val = m.value !== undefined ? m.value : m.avg
            if (val !== undefined) {
              metrics[m.metrics_type] = val
            }
          })

          // 2. Map friendly names from the raw metrics we just populated
          // Use definitions if available, otherwise null
          metrics.power = metrics['XPUM_STATS_POWER'] ?? 0
          metrics.frequency = metrics['XPUM_STATS_GPU_FREQUENCY'] ?? 0
          metrics.memory_used = metrics['XPUM_STATS_MEMORY_USED'] ?? 0
          metrics.memory_utilization =
            metrics['XPUM_STATS_MEMORY_UTILIZATION'] ?? 0
          metrics.media_engine_frequency =
            metrics['XPUM_STATS_MEDIA_ENGINE_FREQUENCY'] ?? 0

          // Compute Usage logic
          let computeUsage =
            metrics['XPUM_STATS_ENGINE_GROUP_COMPUTE_ALL_UTILIZATION']
          if (computeUsage === undefined || computeUsage === null) {
            computeUsage =
              metrics['XPUM_STATS_ENGINE_GROUP_RENDER_ALL_UTILIZATION']
          }
          if (computeUsage === undefined || computeUsage === null) {
            computeUsage = metrics['XPUM_STATS_GPU_UTILIZATION']
          }
          // If we still don't have it, try to infer loosely from memory util if it's high? No that's misleading.
          // Or just leave it as null/0.
          metrics.compute_usage = computeUsage ?? 0
        }

        resolve(metrics)
        spawnedProcess.kill()
      } catch (error) {
        clearTimeout(timeout)
        reject(error)
        spawnedProcess.kill()
      }
    })

    spawnedProcess.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
      spawnedProcess.kill()
    })

    spawnedProcess.on('close', () => {
      clearTimeout(timeout)
      // If we haven't resolved yet (shouldn't happen with the timeout logic but good safety)
    })
  })
}

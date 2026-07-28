// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { promises as fsPromises } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { UV_PATH, WORKER_DIR } from '@/lib/constants'
import { spawnWithTimeout } from '@/app/api/devices/query-devices'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

function detectOS(): 'linux' | 'windows' | 'macos' {
  const platform = os.platform()
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  return 'linux'
}

// Parses a Linux cpulist (kernel format) like "0-7,10,12-15" into a sorted unique array.
function parseCpuList(value: string): number[] {
  const out = new Set<number>()
  for (const part of value.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    if (trimmed.includes('-')) {
      const [lo, hi] = trimmed.split('-').map((n) => Number(n.trim()))
      if (Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi) {
        for (let i = lo; i <= hi; i++) out.add(i)
      }
    } else {
      const n = Number(trimmed)
      if (Number.isFinite(n)) out.add(n)
    }
  }
  return [...out].sort((a, b) => a - b)
}

async function detectHybridTopology(): Promise<{
  pCoreIds: number[]
  eCoreIds: number[]
} | null> {
  if (os.platform() !== 'linux') return null
  try {
    const [pRaw, eRaw] = await Promise.all([
      fsPromises.readFile('/sys/devices/cpu_core/cpus', 'utf8'),
      fsPromises.readFile('/sys/devices/cpu_atom/cpus', 'utf8'),
    ])
    const pCoreIds = parseCpuList(pRaw.trim())
    const eCoreIds = parseCpuList(eRaw.trim())
    if (pCoreIds.length === 0 || eCoreIds.length === 0) return null
    return { pCoreIds, eCoreIds }
  } catch {
    return null
  }
}

async function runDeviceScript(
  scriptPath: string,
  cwd: string,
): Promise<{ id: string; name: string }[]> {
  try {
    const result = await spawnWithTimeout(
      UV_PATH,
      ['run', '--no-sync', '--frozen', scriptPath],
      { cwd, env: { ...process.env } },
    )
    if (result.exitCode !== 0) return []
    return JSON.parse(result.stdout.trim())
  } catch {
    return []
  }
}

async function detectDevices(): Promise<string[]> {
  const helperDir = path.join(WORKER_DIR, 'helper')
  const ovinoScript = path.join(helperDir, 'openvino_device.py')
  const pytorchScript = path.join(helperDir, 'pytorch_device.py')

  const [ovinoDevices, pytorchDevices] = await Promise.all([
    runDeviceScript(ovinoScript, helperDir),
    runDeviceScript(pytorchScript, helperDir),
  ])

  const ids = new Set<string>()

  for (const device of [...ovinoDevices, ...pytorchDevices]) {
    ids.add(device.id)
  }

  for (const id of [...ids]) {
    const base = id.split(/[.:]/)[0].toLowerCase()
    if (base === 'cpu') {
      ids.add('cpu')
    } else if (base === 'gpu' || base === 'xpu') {
      ids.add('gpu')
      ids.add('xpu')
    } else if (base === 'npu') {
      ids.add('npu')
    }
  }

  if (ids.size === 0) ids.add('cpu')

  logger.info(`Detected devices: ${[...ids].join(', ')}`)
  return [...ids]
}

export async function GET() {
  const [osResult, devices, hybrid] = await Promise.all([
    detectOS(),
    detectDevices(),
    detectHybridTopology(),
  ])

  return NextResponse.json({
    os: osResult,
    devices,
    cpuCount: os.cpus().length,
    ...(hybrid && { pCoreIds: hybrid.pCoreIds, eCoreIds: hybrid.eCoreIds }),
  })
}

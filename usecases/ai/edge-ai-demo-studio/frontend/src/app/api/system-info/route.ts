// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

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
  const [osResult, devices] = await Promise.all([detectOS(), detectDevices()])

  return NextResponse.json({
    os: osResult,
    devices,
  })
}

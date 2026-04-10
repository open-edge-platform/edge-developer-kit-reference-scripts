// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import os from 'node:os'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { MULTISERVE_REPO_PATH } from '@/engines/multiserve/data'
import { logger } from '@/lib/logger'
import { spawnWithTimeout } from '../query-devices'

const isWindows = os.platform() === 'win32'

function parseLlamaDevices(output: string) {
  const devices: { id: string; name: string }[] = []

  const cpuMatch = output.match(
    /loaded CPU backend from .+[\\/](?:lib)?ggml-cpu-([^.]+)\.(?:so|dll)/,
  )
  if (cpuMatch) {
    devices.push({ id: 'CPU', name: `${cpuMatch[1]} (CPU)` })
  }

  const vulkanMatches = output.matchAll(
    /(?:Vulkan|SYCL)(\d+):\s+(.+?)\s+\(\d+\s+MiB/g,
  )
  for (const match of vulkanMatches) {
    const deviceNum = Number.parseInt(match[1], 5)
    const deviceName = match[2].trim()
    devices.push({ id: `GPU.${deviceNum}`, name: `${deviceName} (GPU)` })
  }

  return devices
}

export async function GET() {
  try {
    const llamaServerPath = path.join(
      MULTISERVE_REPO_PATH,
      'engine',
      'llama.cpp-vulkan',
      isWindows ? 'llama-server.exe' : 'llama-server',
    )

    const result = await spawnWithTimeout(llamaServerPath, ['--list-devices'])

    if (result.exitCode !== 0) {
      logger.error('Process failed with code:', result.exitCode)
      logger.error('stderr:', result.stderr)
      return NextResponse.json(
        {
          error: 'Failed to query Vulkan devices',
          details: result.stderr || result.stdout,
          exitCode: result.exitCode,
        },
        { status: 500 },
      )
    }

    const devices = parseLlamaDevices(result.stdout + result.stderr)
    return NextResponse.json({ devices })
  } catch (error) {
    logger.error('Route error:', error)
    if (error instanceof Error && error.message === 'Process timed out') {
      return NextResponse.json(
        { error: 'Device query process timed out' },
        { status: 408 },
      )
    }
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to query Vulkan devices'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

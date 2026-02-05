// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { MULTISERVE_REPO_PATH } from '@/lib/constants'
import path from 'path'
import os from 'os'
import { logger } from '@/utils/logger'

const isWindows = os.platform() === 'win32'

export async function GET() {
  try {
    // Path to the llama-server executable
    const llamaServerPath = path.join(
      MULTISERVE_REPO_PATH,
      'engine',
      'llama.cpp-vulkan',
      isWindows
        ? 'llama-server.exe'
        : path.join('build', 'bin', 'llama-server'),
    )

    // Arguments for llama-server command
    const args = ['--list-devices']

    // Create and await the child process
    const result = await new Promise<{
      stdout: string
      stderr: string
      exitCode: number | null
    }>((resolve, reject) => {
      const proc = spawn(llamaServerPath, args, {
        env: { ...process.env },
      })

      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code,
        })
      })

      proc.on('error', (error) => {
        reject(error)
      })

      // Set a timeout to prevent hanging
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGTERM')
          reject(new Error('Process timed out'))
        }
      }, 30000) // 30 second timeout
    })

    // Process completed, now handle the result
    if (result.exitCode === 0) {
      try {
        // Parse the llama-server output
        const output = result.stdout + result.stderr
        const devices: Record<string, string>[] = []

        // Look for CPU backend line
        const cpuMatch = output.match(
          /loaded CPU backend from .+[\\/](?:lib)?ggml-cpu-([^.]+)\.(?:so|dll)/,
        )
        if (cpuMatch) {
          devices.push({ id: 'CPU', name: `${cpuMatch[1]} (CPU)` })
        }

        // Look for Vulkan/SYCL devices in the output
        // Match lines like "  Vulkan0: Intel(R) Graphics (ARL) (64077 MiB, 57669 MiB free)"
        // or "  SYCL0: Intel(R) UHD Graphics 770 (30147 MiB, 30147 MiB free)"
        const vulkanMatches = output.matchAll(
          /(?:Vulkan|SYCL)(\d+):\s+(.+?)\s+\(\d+\s+MiB/g,
        )

        for (const match of vulkanMatches) {
          const deviceNum = parseInt(match[1])
          const deviceName = match[2].trim()
          devices.push({
            id: `GPU.${deviceNum}`,
            name: `${deviceName} (GPU)`,
          })
        }

        return NextResponse.json({
          devices,
        })
      } catch (parseError) {
        logger.error('Failed to parse device output:', parseError)
        return NextResponse.json(
          {
            error: 'Failed to parse device information',
            details: result.stdout + result.stderr,
          },
          { status: 500 },
        )
      }
    } else {
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
  } catch (error) {
    logger.error('Route error:', error)
    if (error instanceof Error && error.message === 'Process timed out') {
      return NextResponse.json(
        {
          error: 'Device query process timed out',
        },
        { status: 408 },
      )
    }

    let errorMessage = 'Failed to query Vulkan devices'
    if (error instanceof Error) {
      errorMessage = error.message
    }
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

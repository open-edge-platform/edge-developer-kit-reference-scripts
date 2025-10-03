// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { WORKER_DIR } from '@/lib/constants'
import path from 'path'
import os from 'os'

const isWindows = os.platform() === 'win32'

export async function GET() {
  try {
    // Path to the uv executable
    const uvPath = path.join(
      WORKER_DIR,
      'thirdparty',
      'uv',
      isWindows ? 'uv.exe' : 'uv',
    )

    // Path to the query_device.py script
    const scriptPath = path.join(
      WORKER_DIR,
      'lipsync',
      'scripts',
      'query_device.py',
    )

    // Arguments for uv run command
    const args = ['run', '--no-sync', '--frozen', scriptPath]

    // Create and await the child process
    const result = await new Promise<{
      stdout: string
      stderr: string
      exitCode: number | null
    }>((resolve, reject) => {
      const proc = spawn(uvPath, args, {
        cwd: path.join(WORKER_DIR, 'lipsync'),
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
        // Parse the JSON output directly
        const devices = JSON.parse(result.stdout.trim())

        // Validate the structure
        if (!Array.isArray(devices)) {
          throw new Error('Expected devices to be an array')
        }

        // Validate each device has required properties
        for (const device of devices) {
          if (!device.id || !device.name) {
            throw new Error('Each device must have id and name properties')
          }
        }

        return NextResponse.json({
          devices,
        })
      } catch (parseError) {
        console.error('Failed to parse device output:', parseError)
        return NextResponse.json(
          {
            error: 'Failed to parse device information',
            details: result.stdout,
          },
          { status: 500 },
        )
      }
    } else {
      console.error('Process failed with code:', result.exitCode)
      console.error('stderr:', result.stderr)
      return NextResponse.json(
        {
          error: 'Failed to query PyTorch devices',
          details: result.stderr || result.stdout,
          exitCode: result.exitCode,
        },
        { status: 500 },
      )
    }
  } catch (error) {
    console.error('Route error:', error)
    if (error instanceof Error && error.message === 'Process timed out') {
      return NextResponse.json(
        {
          error: 'Device query process timed out',
        },
        { status: 408 },
      )
    }

    let errorMessage = 'Failed to query PyTorch devices'
    if (error instanceof Error) {
      errorMessage = error.message
    }
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

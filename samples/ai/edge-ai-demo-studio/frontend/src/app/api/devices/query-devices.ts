// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process'
import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

interface Device {
  id: string
  name: string
}

interface SpawnResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

const TIMEOUT_MS = 30000

export function spawnWithTimeout(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env ?? { ...process.env },
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
      resolve({ stdout, stderr, exitCode: code })
    })

    proc.on('error', (error) => {
      reject(error)
    })

    setTimeout(() => {
      if (!proc.killed) {
        proc.kill('SIGTERM')
        reject(new Error('Process timed out'))
      }
    }, TIMEOUT_MS)
  })
}

function handleDeviceQueryError(error: unknown, backendLabel: string) {
  logger.error('Route error:', error)

  if (error instanceof Error && error.message === 'Process timed out') {
    return NextResponse.json(
      { error: 'Device query process timed out' },
      { status: 408 },
    )
  }

  const errorMessage =
    error instanceof Error
      ? error.message
      : `Failed to query ${backendLabel} devices`
  return NextResponse.json({ error: errorMessage }, { status: 500 })
}

export function createJsonDeviceQueryHandler(
  scriptPath: string,
  cwd: string,
  uvPath: string,
  backendLabel: string,
) {
  return async function GET() {
    try {
      const result = await spawnWithTimeout(
        uvPath,
        ['run', '--no-sync', '--frozen', scriptPath],
        { cwd, env: { ...process.env } },
      )

      if (result.exitCode !== 0) {
        logger.error('Process failed with code:', result.exitCode)
        logger.error('stderr:', result.stderr)
        return NextResponse.json(
          {
            error: `Failed to query ${backendLabel} devices`,
            details: result.stderr || result.stdout,
            exitCode: result.exitCode,
          },
          { status: 500 },
        )
      }

      const devices: Device[] = JSON.parse(result.stdout.trim())

      if (!Array.isArray(devices)) {
        throw new Error('Expected devices to be an array')
      }

      for (const device of devices) {
        if (!device.id || !device.name) {
          throw new Error('Each device must have id and name properties')
        }
        device.name = `${device.name} (${device.id})`
      }

      return NextResponse.json({ devices })
    } catch (error) {
      if (
        error instanceof SyntaxError ||
        (error instanceof Error && error.message.includes('Expected'))
      ) {
        logger.error('Failed to parse device output:', error)
        return NextResponse.json(
          { error: 'Failed to parse device information' },
          { status: 500 },
        )
      }
      return handleDeviceQueryError(error, backendLabel)
    }
  }
}

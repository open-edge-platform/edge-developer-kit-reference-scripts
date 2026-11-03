// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Accelerator discovery via the OpenVINO/PyTorch helper scripts and llama.cpp's device list. */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { MULTISERVE_REPO_PATH } from '@/engines/multiserve/paths'
import type { LlamaBuild } from '@/engines/multiserve/types'
import { ApiError } from '@/lib/api/errors'
import { UV_PATH, WORKER_DIR } from '@/lib/constants'
import { logger } from '@/lib/logger'
import {
  CommandInterruptedError,
  runCommand,
  type RunCommandOptions,
} from '@/lib/system/spawn'

const isWindows = os.platform() === 'win32'

export interface DeviceInfo {
  id: string
  name: string
}

const HELPER_DIR = path.join(WORKER_DIR, 'services', 'helper')

const DEVICE_SCRIPTS = {
  openvino: { label: 'OpenVINO', script: 'openvino_device.py' },
  pytorch: { label: 'PyTorch', script: 'pytorch_device.py' },
} as const

export type DeviceScriptBackend = keyof typeof DEVICE_SCRIPTS

const deviceListSchema = z.array(
  z.object({ id: z.string().min(1), name: z.string().min(1) }),
)

/** A failed query, answered 500 — or 504 when the command timed out. */
function queryError(label: string, error: unknown): ApiError {
  if (error instanceof CommandInterruptedError) {
    return new ApiError(504, 'Device query process timed out', {
      cause: error,
    })
  }
  if (error instanceof ApiError) return error
  logger.error(`${label} device query failed:`, error)
  return new ApiError(500, `Failed to query ${label} devices`, {
    cause: error,
  })
}

async function runQuery(
  label: string,
  command: string,
  args: string[],
  options?: RunCommandOptions,
) {
  const result = await runCommand(command, args, options)
  if (result.exitCode !== 0) {
    logger.error(
      `${label} device query exited ${result.exitCode}: ${result.stderr}`,
    )
    throw new ApiError(
      500,
      `Failed to query ${label} devices: ${(result.stderr || result.stdout).trim()}`,
    )
  }
  return result
}

/** Devices a helper script reports, named `<name> (<id>)`. Throws an `ApiError` (500, or 504). */
export async function queryScriptDevices(
  backend: DeviceScriptBackend,
): Promise<DeviceInfo[]> {
  const { label, script } = DEVICE_SCRIPTS[backend]
  try {
    const { stdout } = await runQuery(
      label,
      UV_PATH,
      ['run', '--no-sync', '--frozen', path.join(HELPER_DIR, script)],
      { cwd: HELPER_DIR },
    )
    const parsed = deviceListSchema.safeParse(JSON.parse(stdout.trim()))
    if (!parsed.success) {
      throw new ApiError(500, 'Failed to parse device information')
    }
    return parsed.data.map((device) => ({
      id: device.id,
      name: `${device.name} (${device.id})`,
    }))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ApiError(500, 'Failed to parse device information')
    }
    throw queryError(label, error)
  }
}

/** Device ids the helper scripts report, or none when they cannot run. */
export async function listScriptDeviceIds(): Promise<string[]> {
  const results = await Promise.allSettled(
    (Object.keys(DEVICE_SCRIPTS) as DeviceScriptBackend[]).map(
      queryScriptDevices,
    ),
  )
  return results.flatMap((result) =>
    result.status === 'fulfilled' ? result.value.map((d) => d.id) : [],
  )
}

// setup.sh installs exactly one llama.cpp build (vulkan or sycl); use whichever is on disk.
function resolveLlamaServer(): { build: LlamaBuild; path: string } | null {
  for (const build of ['vulkan', 'sycl'] as const) {
    const candidate = path.join(
      MULTISERVE_REPO_PATH,
      'engine',
      `llama.cpp-${build}`,
      isWindows ? 'llama-server.exe' : 'llama-server',
    )
    if (fs.existsSync(candidate)) return { build, path: candidate }
  }
  return null
}

// llama-server runs here before the engine is up, so ask backend_env.sh for the engine's
// environment: the SYCL build cannot load without workers/.venv/lib on LD_LIBRARY_PATH.
async function getBackendEnv(): Promise<NodeJS.ProcessEnv> {
  const fallback = { ...process.env }
  if (isWindows) return fallback

  const script = path.join(MULTISERVE_REPO_PATH, 'backend_env.sh')
  if (!fs.existsSync(script)) return fallback

  try {
    const { stdout, stderr, exitCode } = await runCommand(
      '/bin/bash',
      [script],
      {
        cwd: MULTISERVE_REPO_PATH,
      },
    )
    if (exitCode !== 0) {
      logger.error(`backend_env.sh failed (${exitCode}): ${stderr.trim()}`)
      return fallback
    }
    const resolved: Record<string, string> = {}
    for (const entry of stdout.split('\0')) {
      const eq = entry.indexOf('=')
      if (eq > 0) resolved[entry.slice(0, eq)] = entry.slice(eq + 1)
    }
    // The script prints the whole environment the engine would run with.
    return Object.keys(resolved).length > 0
      ? (resolved as NodeJS.ProcessEnv)
      : fallback
  } catch (error) {
    logger.error('backend_env.sh could not run:', error)
    return fallback
  }
}

/**
 * CPU and GPUs from `llama-server --list-devices`. Only the Vulkan build prints its CPU backend;
 * SYCL links it in and lists GPUs alone, so the CPU is then named after the host processor.
 */
function parseLlamaDevices(output: string): DeviceInfo[] {
  const cpuMatch = output.match(
    /loaded CPU backend from .+[\\/](?:lib)?ggml-cpu-([^.]+)\.(?:so|dll)/,
  )
  const cpuName = cpuMatch?.[1] ?? (os.cpus()[0]?.model.trim() || 'CPU')
  const devices: DeviceInfo[] = [{ id: 'CPU', name: `${cpuName} (CPU)` }]

  for (const match of output.matchAll(
    /(?:Vulkan|SYCL)(\d+):\s+(.+?)\s+\(\d+\s+MiB/g,
  )) {
    const deviceNum = Number.parseInt(match[1], 10)
    devices.push({ id: `GPU.${deviceNum}`, name: `${match[2].trim()} (GPU)` })
  }

  return devices
}

/** The devices llama.cpp can run on, and which build reported them. Throws an `ApiError`. */
export async function queryLlamaDevices(): Promise<{
  build: LlamaBuild
  devices: DeviceInfo[]
}> {
  const llamaServer = resolveLlamaServer()
  if (!llamaServer) {
    throw new ApiError(
      500,
      'No llama.cpp build found in the multiserve engine directory. Run ./setup.sh to install one.',
    )
  }
  try {
    const { stdout, stderr } = await runQuery(
      'llama.cpp',
      llamaServer.path,
      ['--list-devices'],
      { env: await getBackendEnv() },
    )
    return {
      build: llamaServer.build,
      devices: parseLlamaDevices(stdout + stderr),
    }
  } catch (error) {
    throw queryError('llama.cpp', error)
  }
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** What this machine is: OS, accelerators, CPU cores (`GET /api/system-info`). */

import { promises as fsPromises } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { WORKER_DIR } from '@/lib/constants'
import { parseCpuAffinity } from '@/lib/instances/cpu-affinity'
import { logger } from '@/lib/logger'
import { listScriptDeviceIds } from '@/lib/system/devices'
import { runCommand } from '@/lib/system/spawn'
import type { HostOS } from '@/types/common'

/** What `GET /api/system-info` answers. */
export interface SystemInfoResponse {
  os: HostOS
  /** Accelerator families present: `cpu`, `gpu`/`xpu`, `npu`. */
  devices: string[]
  cpuCount: number
  /** Performance and efficiency core ids, on hybrid Intel CPUs (Linux, Windows). */
  pCoreIds?: number[]
  eCoreIds?: number[]
}

function detectOS(): HostOS {
  const platform = os.platform()
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  return 'linux'
}

interface HybridTopology {
  pCoreIds: number[]
  eCoreIds: number[]
}

async function detectHybridTopology(): Promise<HybridTopology | null> {
  if (os.platform() === 'win32') return detectWindowsHybridTopology()
  if (os.platform() !== 'linux') return null
  try {
    const [pRaw, eRaw] = await Promise.all([
      fsPromises.readFile('/sys/devices/cpu_core/cpus', 'utf8'),
      fsPromises.readFile('/sys/devices/cpu_atom/cpus', 'utf8'),
    ])
    const pCoreIds = [...parseCpuAffinity(pRaw.trim())].sort((a, b) => a - b)
    const eCoreIds = [...parseCpuAffinity(eRaw.trim())].sort((a, b) => a - b)
    if (pCoreIds.length === 0 || eCoreIds.length === 0) return null
    return { pCoreIds, eCoreIds }
  } catch (error) {
    // Not a hybrid CPU: the sysfs entries do not exist.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.debug('Could not read the CPU core topology:', error)
    }
    return null
  }
}

const cpuSetsSchema = z.array(
  z.object({ id: z.number().int(), efficiencyClass: z.number().int() }),
)

// Core types do not change while the app runs, and each read starts PowerShell: read once.
let windowsTopology: Promise<HybridTopology | null> | undefined

function detectWindowsHybridTopology(): Promise<HybridTopology | null> {
  if (!windowsTopology) windowsTopology = readWindowsHybridTopology()
  return windowsTopology
}

/**
 * The efficiency class of each logical processor (workers/scripts/cpu-topology.ps1). The highest
 * class is the P-cores; every lower one, low-power E-cores included, counts as E-cores, as Linux's
 * cpu_atom does.
 */
async function readWindowsHybridTopology(): Promise<HybridTopology | null> {
  try {
    const script = path.join(WORKER_DIR, 'scripts', 'cpu-topology.ps1')
    const { stdout, stderr, exitCode } = await runCommand('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
    ])
    if (exitCode !== 0) {
      throw new Error(`cpu-topology.ps1 exited ${exitCode}: ${stderr.trim()}`)
    }
    const cpus = cpuSetsSchema.parse(JSON.parse(stdout))
    const top = Math.max(...cpus.map((c) => c.efficiencyClass))
    const ids = (pCores: boolean) =>
      cpus
        .filter((c) => (c.efficiencyClass === top) === pCores)
        .map((c) => c.id)
        .sort((a, b) => a - b)
    const pCoreIds = ids(true)
    const eCoreIds = ids(false)
    if (pCoreIds.length === 0 || eCoreIds.length === 0) return null
    return { pCoreIds, eCoreIds }
  } catch (error) {
    logger.debug('Could not read the CPU core topology:', error)
    return null
  }
}

/** The device families the helper scripts find; `cpu` at least. */
async function detectDevices(): Promise<string[]> {
  const ids = new Set(await listScriptDeviceIds())

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

export async function readSystemInfo(): Promise<SystemInfoResponse> {
  const [devices, hybrid] = await Promise.all([
    detectDevices(),
    detectHybridTopology(),
  ])
  return {
    os: detectOS(),
    devices,
    cpuCount: os.cpus().length,
    ...(hybrid && { pCoreIds: hybrid.pCoreIds, eCoreIds: hybrid.eCoreIds }),
  }
}

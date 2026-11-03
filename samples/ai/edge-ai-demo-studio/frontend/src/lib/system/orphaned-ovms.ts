// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Boot-time reaper for OVMS processes that outlived their worker despite PR_SET_PDEATHSIG (SIGTERM
 * ignored while compiling, power loss, no `prctl`) and were reparented out of reach. Kills only
 * this checkout's OVMS binary whose parent is not one of our workers, so a second studio serving
 * from the same checkout is safe: a live worker's OVMS keeps that worker as its parent.
 */

import path from 'node:path'
import { WORKER_DIR } from '@/lib/constants'
import { logger } from '@/lib/logger'
import {
  killPid,
  listSystemProcesses,
  type SystemProcess,
} from '@/lib/system/processes'

const isWindows = process.platform === 'win32'

/** This checkout's OVMS binary — the only one this module will ever kill. */
function ovmsExecutable(): string {
  return path.join(
    WORKER_DIR,
    'thirdparty',
    'ovms',
    'bin',
    isWindows ? 'ovms.exe' : 'ovms',
  )
}

/** Whether `command` runs from this checkout's `workers/`, as every live OVMS's parent does. */
function isWorkerCommand(command: string): boolean {
  return command.includes(WORKER_DIR)
}

/** Kills every OVMS from this checkout whose worker is gone; returns their pids. Never throws. */
export async function sweepOrphanedOvms(): Promise<number[]> {
  const executable = ovmsExecutable()
  let processes: SystemProcess[]
  try {
    processes = await listSystemProcesses()
  } catch (error) {
    logger.error('Could not list processes to sweep orphaned OVMS:', error)
    return []
  }

  const byPid = new Map(processes.map((p) => [p.pid, p]))
  const orphans = processes.filter((p) => {
    if (!p.command.includes(executable)) return false
    const parent = byPid.get(p.ppid)
    return parent === undefined || !isWorkerCommand(parent.command)
  })

  const stopped: number[] = []
  for (const orphan of orphans) {
    logger.warn(
      `Stopping orphaned OVMS ${orphan.pid} (its worker is gone): ${orphan.command.slice(0, 160)}`,
    )
    // SIGTERM first: OVMS closes its ports and unloads its models on it.
    if (await killPid(orphan.pid, { graceMs: 2_000 })) stopped.push(orphan.pid)
  }
  return stopped
}

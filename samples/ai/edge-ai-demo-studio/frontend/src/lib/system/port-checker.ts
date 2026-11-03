// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Boot-time port check on instance and reserved ports: stops this checkout's leftover processes,
 * reports any other listener, and lets the app start anyway.
 */

import os from 'node:os'
import path from 'node:path'
import { sleep } from '@/lib/async'
import { REPO_ROOT } from '@/lib/constants'
import { logger } from '@/lib/logger'
import {
  findPortListeners,
  isDescendantOf,
  killPid,
  listSystemProcesses,
  type SystemProcess,
} from '@/lib/system/processes'
import { getReservedPorts } from '@/lib/workers/instance-ports'

const isWindows = os.platform() === 'win32'

export interface PortConflict {
  port: number
  pid: number
  ppid?: number
  processName: string
  commandLine?: string
}

// A root this shallow can only come from misresolution; matching against
// it would classify other checkouts' processes as ours.
function isUnsafeProjectRoot(projectRoot: string): boolean {
  return path.dirname(projectRoot) === projectRoot
}

const ALLOWED_PROCESS_IDENTIFIERS = {
  executableNames: [
    'python',
    'python3',
    'python.exe',
    'python3.exe',
    'node',
    'node.exe',
    'ovms',
    'ovms.exe',
  ],
  scriptNames: ['main.py', 'uvicorn'],
  frameworkMarkers: ['fastapi'],
} as const

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

function containsWholeWord(haystack: string, needle: string): boolean {
  const haystackLower = haystack.toLowerCase()
  const needleLower = needle.toLowerCase()

  let index = haystackLower.indexOf(needleLower)
  while (index !== -1) {
    const beforeChar = index > 0 ? haystack[index - 1] : ' '
    const afterChar =
      index + needle.length < haystack.length
        ? haystack[index + needle.length]
        : ' '
    if (!/[a-zA-Z0-9_]/.test(beforeChar) && !/[a-zA-Z0-9_]/.test(afterChar)) {
      return true
    }
    index = haystackLower.indexOf(needleLower, index + 1)
  }
  return false
}

/**
 * Whether a command line is this checkout's worker or server: runs from the repo with an allowed
 * executable, plus a worker directory, script or framework marker.
 */
function belongsToProject(commandLine: string | undefined): boolean {
  if (!commandLine) return false
  if (isUnsafeProjectRoot(REPO_ROOT)) {
    logger.warn(
      `Project root resolved to "${REPO_ROOT}" — refusing to claim ownership of processes`,
    )
    return false
  }

  const cmdNormalized = normalizePath(commandLine)
  if (!cmdNormalized.includes(normalizePath(REPO_ROOT))) return false

  const hasAllowedExecutable = ALLOWED_PROCESS_IDENTIFIERS.executableNames.some(
    (exe) => containsWholeWord(commandLine, exe),
  )
  if (!hasAllowedExecutable) return false

  const inWorkersDirectory = cmdNormalized.includes(
    normalizePath(path.join(REPO_ROOT, 'workers')),
  )
  const hasAllowedScript = ALLOWED_PROCESS_IDENTIFIERS.scriptNames.some(
    (script) => containsWholeWord(commandLine, script),
  )
  const hasAllowedFramework = ALLOWED_PROCESS_IDENTIFIERS.frameworkMarkers.some(
    (marker) => containsWholeWord(commandLine, marker),
  )
  return inWorkersDirectory || hasAllowedScript || hasAllowedFramework
}

/** Who listens on each of `ports`, with their command lines. */
async function findListeners(ports: number[]): Promise<PortConflict[]> {
  let listeners: Map<number, number>
  try {
    listeners = await findPortListeners(ports)
  } catch (error) {
    // Not the same as "every port is free": say the check could not run.
    logger.warn(
      `Could not check which ports are in use (${isWindows ? 'netstat' : 'lsof'} unavailable?):`,
      error,
    )
    return []
  }
  if (listeners.size === 0) return []

  let byPid = new Map<number, SystemProcess>()
  try {
    byPid = new Map((await listSystemProcesses()).map((p) => [p.pid, p]))
  } catch (error) {
    logger.warn('Could not read the processes holding ports:', error)
  }
  return [...listeners].map(([port, pid]) => {
    const info = byPid.get(pid)
    return {
      port,
      pid,
      ppid: info?.ppid,
      processName: info?.name || 'Unknown',
      commandLine: info?.command || undefined,
    }
  })
}

function reportExternalProcesses(external: PortConflict[]): void {
  logger.warn('⚠️  PORT CONFLICT DETECTED!')
  logger.warn('The following ports are in use by external processes:')
  for (const conflict of external) {
    logger.warn(
      `  Port ${conflict.port}: PID ${conflict.pid} (${conflict.processName})${conflict.commandLine ? ` — ${conflict.commandLine}` : ''}`,
    )
  }
  logger.warn(
    'External processes on these ports may make services fail to start. To stop them:',
  )
  for (const conflict of external) {
    logger.warn(
      isWindows
        ? `  taskkill /PID ${conflict.pid} /F`
        : `  kill -9 ${conflict.pid}`,
    )
  }
}

/**
 * Checks reserved ports and `extraPorts` (ports instances held at last stop); stops this
 * checkout's leftovers and returns the ports freed and the external processes left.
 */
export async function checkAndHandlePortConflicts(
  extraPorts: number[] = [],
): Promise<{ conflicts: PortConflict[]; killedPorts: number[] }> {
  logger.log('Checking port availability...')

  const ports = [...new Set([...getReservedPorts(), ...extraPorts])]
  const occupied = await findListeners(ports)
  if (occupied.length === 0) {
    logger.log('✅ All required ports are available.')
    return { conflicts: [], killedPorts: [] }
  }

  const killedPorts: number[] = []
  const failed: number[] = []
  const external: PortConflict[] = []
  for (const conflict of occupied) {
    if (!belongsToProject(conflict.commandLine)) {
      external.push(conflict)
      continue
    }
    if (await isDescendantOf(conflict.pid, process.pid, conflict.ppid)) {
      logger.log(
        `Skipping process on port ${conflict.port} (PID: ${conflict.pid}) as it is a descendant of this process`,
      )
      continue
    }
    if (await killPid(conflict.pid)) {
      killedPorts.push(conflict.port)
      logger.log(
        `Killed project process on port ${conflict.port} (PID: ${conflict.pid})`,
      )
    } else {
      failed.push(conflict.port)
    }
  }

  if (failed.length > 0) {
    logger.warn(
      `⚠️  Failed to kill project processes on ports: ${failed.join(', ')}`,
    )
  }
  // Give the system a moment to release the ports of what was stopped.
  if (killedPorts.length > 0) await sleep(1000)
  if (external.length > 0) reportExternalProcesses(external)
  return { conflicts: external, killedPorts }
}

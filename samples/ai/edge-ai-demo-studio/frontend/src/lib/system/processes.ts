// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Process inspection without a shell: port listeners, parents, command lines, liveness, stopping.
 * On Windows, process listings come from `Get-CimInstance` (`wmic` is gone from recent Windows 11).
 */

import os from 'node:os'
import { sleep } from '@/lib/async'
import { logger } from '@/lib/logger'
import { runCommand } from '@/lib/system/spawn'

const isWindows = os.platform() === 'win32'

export interface SystemProcess {
  pid: number
  ppid: number
  /** Executable name (`python3`, `ovms.exe`). */
  name: string
  /** Full command line; empty when the OS would not tell. */
  command: string
}

/** `ps -eo pid=,ppid=,args=` output. */
function parsePs(stdout: string): SystemProcess[] {
  return stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (!match) return []
    const command = match[3].trim()
    const executable = command.split(/\s+/)[0] ?? ''
    return [
      {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        name: executable.split('/').pop() ?? executable,
        command,
      },
    ]
  })
}

/** `Get-CimInstance Win32_Process | … | ConvertTo-Json` output. */
function parseCimJson(stdout: string): SystemProcess[] {
  const parsed: unknown = JSON.parse(stdout.trim() || '[]')
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const { ProcessId, ParentProcessId, Name, CommandLine } = row as Record<
      string,
      unknown
    >
    if (typeof ProcessId !== 'number' || typeof ParentProcessId !== 'number') {
      return []
    }
    return [
      {
        pid: ProcessId,
        ppid: ParentProcessId,
        name: typeof Name === 'string' ? Name : '',
        command: typeof CommandLine === 'string' ? CommandLine : '',
      },
    ]
  })
}

/**
 * Listening TCP ports and their pids from `netstat -ano`. The local address
 * must end in exactly `:<port>`, so port 800 never matches 8000.
 */
function parseNetstatListeners(stdout: string): Map<number, number> {
  const listeners = new Map<number, number>()
  for (const line of stdout.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 5 || fields[0].toUpperCase() !== 'TCP') continue
    if (fields[3].toUpperCase() !== 'LISTENING') continue
    const port = Number(fields[1].slice(fields[1].lastIndexOf(':') + 1))
    const pid = Number(fields[4])
    if (Number.isInteger(port) && Number.isInteger(pid) && !listeners.has(port))
      listeners.set(port, pid)
  }
  return listeners
}

const CIM_SCRIPT =
  'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'

async function listWindowsProcesses(): Promise<SystemProcess[]> {
  const { stdout, exitCode, stderr } = await runCommand('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    CIM_SCRIPT,
  ])
  if (exitCode !== 0) {
    throw new Error(`Get-CimInstance failed (${exitCode}): ${stderr.trim()}`)
  }
  return parseCimJson(stdout)
}

/** Every process on the machine, with its parent and command line. Throws when none can be read. */
export async function listSystemProcesses(): Promise<SystemProcess[]> {
  if (isWindows) return listWindowsProcesses()
  const { stdout, exitCode, stderr } = await runCommand('ps', [
    '-eo',
    'pid=,ppid=,args=',
  ])
  if (exitCode !== 0) throw new Error(`ps failed (${exitCode}): ${stderr}`)
  return parsePs(stdout)
}

/**
 * The pid listening on each busy port of `ports`. Throws when `lsof`/`netstat` cannot run, so a
 * caller can tell "nothing listens" from "could not look".
 */
export async function findPortListeners(
  ports: readonly number[],
): Promise<Map<number, number>> {
  if (isWindows) {
    const { stdout } = await runCommand('netstat', ['-ano'])
    const all = parseNetstatListeners(stdout)
    const listeners = new Map<number, number>()
    for (const port of ports) {
      const pid = all.get(port)
      if (pid !== undefined) listeners.set(port, pid)
    }
    return listeners
  }
  const listeners = new Map<number, number>()
  for (const port of ports) {
    // Exit code 1 with no output: nothing listens on the port.
    const { stdout } = await runCommand('lsof', [
      '-nP',
      `-iTCP:${port}`,
      '-sTCP:LISTEN',
      '-t',
    ])
    const pid = Number.parseInt(stdout.trim().split('\n')[0] ?? '', 10)
    if (Number.isInteger(pid)) listeners.set(port, pid)
  }
  return listeners
}

/** Whether `pid` exists (signal 0; `EPERM` means it exists but is not ours). */
export function isPidAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** `pid`'s parent, or null when it is gone or cannot be read. */
async function getParentPid(pid: number): Promise<number | null> {
  try {
    if (isWindows) {
      const found = (await listWindowsProcesses()).find((p) => p.pid === pid)
      return found ? found.ppid : null
    }
    const { stdout } = await runCommand('ps', [
      '-p',
      String(pid),
      '-o',
      'ppid=',
    ])
    const ppid = Number.parseInt(stdout.trim(), 10)
    return Number.isInteger(ppid) ? ppid : null
  } catch (error) {
    logger.debug(`Could not read the parent of ${pid}:`, error)
    return null
  }
}

/** Whether `pid` is `ancestorPid` or one of its descendants (up to 10 levels). */
export async function isDescendantOf(
  pid: number,
  ancestorPid: number,
  knownPpid?: number,
): Promise<boolean> {
  if (pid === ancestorPid) return true
  let next = knownPpid ?? (await getParentPid(pid))
  for (let depth = 0; next && depth < 10; depth++) {
    if (next === ancestorPid) return true
    next = await getParentPid(next)
  }
  return false
}

/**
 * Stops `pid`: its whole tree via taskkill on Windows; elsewhere SIGTERM, then SIGKILL after
 * `graceMs` (0 sends SIGKILL straight away).
 */
export async function killPid(
  pid: number,
  { graceMs = 0 }: { graceMs?: number } = {},
): Promise<boolean> {
  try {
    if (isWindows) {
      const { exitCode, stderr } = await runCommand('taskkill', [
        '/PID',
        String(pid),
        '/T',
        '/F',
      ])
      if (exitCode !== 0) throw new Error(stderr.trim() || `exit ${exitCode}`)
      return true
    }
    if (graceMs <= 0) {
      process.kill(pid, 'SIGKILL')
      return true
    }
    process.kill(pid, 'SIGTERM')
    await sleep(graceMs)
    if (isPidAlive(pid)) process.kill(pid, 'SIGKILL')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true
    logger.error(`Failed to stop process ${pid}:`, error)
    return false
  }
}

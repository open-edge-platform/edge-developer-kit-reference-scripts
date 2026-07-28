// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { exec } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { logger } from '@/lib/logger'
import { metaMap } from '@/services/_generated/meta'
import { getServicesPortMap } from '@/services/config-registry'

const execPromise = promisify(exec)
const isWindows = os.platform() === 'win32'

interface PortInfo {
  port: number
  pid: number
  ppid?: number
  processName: string
  commandLine?: string
}

interface PortCheckResult {
  port: number
  inUse: boolean
  processInfo?: PortInfo
  belongsToProject: boolean
}

// The server always runs with cwd = frontend/, so the repository root is
// one level up (same convention as WORKER_DIR in constants.ts). Do NOT
// derive this from __dirname: it points at the bundler's chunk output
// directory, whose depth varies by bundler/version — a wrong hop count
// resolves to the filesystem root and makes every process on a tracked
// port look like it belongs to this project.
function getProjectRoot(): string {
  return path.resolve(process.cwd(), '..')
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

    const isWordBoundaryBefore = !/[a-zA-Z0-9_]/.test(beforeChar)
    const isWordBoundaryAfter = !/[a-zA-Z0-9_]/.test(afterChar)

    if (isWordBoundaryBefore && isWordBoundaryAfter) {
      return true
    }

    index = haystackLower.indexOf(needleLower, index + 1)
  }

  return false
}

// Checks if a process belongs to this project via allowlist matching
function belongsToProject(commandLine: string | undefined): boolean {
  if (!commandLine) return false

  const projectRoot = getProjectRoot()
  const cmdNormalized = normalizePath(commandLine)
  const projectRootNormalized = normalizePath(projectRoot)
  logger.log(`Checking if process belongs to project:
  Command Line: ${commandLine}
  Project Root: ${projectRoot}
  Project Root (Normalized): ${projectRootNormalized}
`)

  if (isUnsafeProjectRoot(projectRoot)) {
    logger.warn(
      `Project root resolved to "${projectRoot}" — refusing to claim ownership of processes`,
    )
    return false
  }

  // Check 1: Verify the command contains the project root directory
  if (!cmdNormalized.includes(projectRootNormalized)) {
    return false
  }

  // Check 2: Verify it's running an allowed executable
  const hasAllowedExecutable = ALLOWED_PROCESS_IDENTIFIERS.executableNames.some(
    (exe) => containsWholeWord(commandLine, exe),
  )

  if (!hasAllowedExecutable) {
    return false
  }

  const workersPath = path.join(projectRoot, 'workers')
  const workersPathNormalized = normalizePath(workersPath)

  const inWorkersDirectory = cmdNormalized.includes(workersPathNormalized)

  const hasAllowedScript = ALLOWED_PROCESS_IDENTIFIERS.scriptNames.some(
    (script) => containsWholeWord(commandLine, script),
  )

  const hasAllowedFramework = ALLOWED_PROCESS_IDENTIFIERS.frameworkMarkers.some(
    (marker) => containsWholeWord(commandLine, marker),
  )

  if (!inWorkersDirectory && !hasAllowedScript && !hasAllowedFramework) {
    return false
  }

  return true
}

async function getPortInfoWindows(port: number): Promise<PortInfo | null> {
  try {
    // Use netstat to find the PID
    const { stdout } = await execPromise(
      `netstat -ano | findstr :${port} | findstr LISTENING`,
    )

    if (!stdout.trim()) return null

    const lines = stdout.trim().split('\n')
    const pidMatch = lines[0].match(/\s+(\d+)\s*$/)
    if (!pidMatch) return null

    const pid = parseInt(pidMatch[1], 10)

    // Get process details using WMIC
    try {
      const { stdout: wmicOut } = await execPromise(
        `wmic process where ProcessId=${pid} get Name,CommandLine,ParentProcessId /format:list`,
      )

      const nameMatch = wmicOut.match(/Name=(.+?)[\r\n]/i)
      const cmdMatch = wmicOut.match(/CommandLine=(.+?)[\r\n]/i)
      const ppidMatch = wmicOut.match(/ParentProcessId=(.+?)[\r\n]/i)

      return {
        port,
        pid,
        ppid: ppidMatch ? parseInt(ppidMatch[1].trim(), 10) : undefined,
        processName: nameMatch ? nameMatch[1].trim() : 'Unknown',
        commandLine: cmdMatch ? cmdMatch[1].trim() : undefined,
      }
    } catch (error) {
      logger.log(error)
      // Fallback if WMIC fails
      const { stdout: tasklistOut } = await execPromise(
        `tasklist /FI "PID eq ${pid}" /FO CSV /NH`,
      )
      const taskMatch = tasklistOut.match(/"([^"]+)"/)

      return {
        port,
        pid,
        processName: taskMatch ? taskMatch[1] : 'Unknown',
      }
    }
  } catch (error) {
    logger.log(error)
    return null
  }
}

async function getPortInfoUnix(port: number): Promise<PortInfo | null> {
  try {
    // Use lsof to find the process
    const { stdout } = await execPromise(`lsof -i :${port} -sTCP:LISTEN -t`)

    if (!stdout.trim()) return null

    const pid = parseInt(stdout.trim().split('\n')[0], 10)

    // Get process details
    const { stdout: psOut } = await execPromise(
      `ps -p ${pid} -o ppid=,comm=,command=`,
    )

    const parts = psOut.trim().split(/\s+/)
    const ppid = parseInt(parts[0], 10)
    const processName = parts[1]
    const cmdParts = parts.slice(2)
    const commandLine = cmdParts.join(' ')

    return {
      port,
      pid,
      ppid,
      processName,
      commandLine,
    }
  } catch {
    return null
  }
}

async function checkPort(port: number): Promise<PortCheckResult> {
  const processInfo = isWindows
    ? await getPortInfoWindows(port)
    : await getPortInfoUnix(port)
  if (!processInfo) {
    return {
      port,
      inUse: false,
      belongsToProject: false,
    }
  }

  return {
    port,
    inUse: true,
    processInfo,
    belongsToProject: belongsToProject(processInfo.commandLine),
  }
}

/**
 * Collect all reserved ports from services and samples.
 */
function getReservedPorts(): number[] {
  const ports: number[] = []
  for (const service of Object.values(metaMap)) {
    for (const port of service.reservedPorts ?? []) {
      ports.push(port)
    }
  }
  return ports
}

async function checkAllPorts(): Promise<PortCheckResult[]> {
  const allPorts = new Set([
    ...Object.values(getServicesPortMap()),
    ...getReservedPorts(),
  ])
  const results = await Promise.all(
    [...allPorts].map((port) => checkPort(port)),
  )
  return results
}

async function killProcess(pid: number): Promise<boolean> {
  try {
    if (isWindows) {
      await execPromise(`taskkill /PID ${pid} /T /F`)
    } else {
      await execPromise(`kill -9 ${pid}`)
    }
    return true
  } catch (error) {
    logger.error(`Failed to kill process ${pid}:`, error)
    return false
  }
}

async function getParentPid(pid: number): Promise<number | null> {
  try {
    if (isWindows) {
      const { stdout } = await execPromise(
        `wmic process where ProcessId=${pid} get ParentProcessId /format:value`,
      )
      const match = stdout.match(/ParentProcessId=(\d+)/)
      return match ? parseInt(match[1], 10) : null
    } else {
      const { stdout } = await execPromise(`ps -p ${pid} -o ppid=`)
      const trimmed = stdout.trim()
      return trimmed ? parseInt(trimmed, 10) : null
    }
  } catch {
    return null
  }
}

async function isDescendant(
  pid: number,
  ancestorPid: number,
  knownPpid?: number,
): Promise<boolean> {
  if (pid === ancestorPid) return true

  let currentPid = pid
  let nextPpid = knownPpid ?? (await getParentPid(currentPid))
  const MAX_DEPTH = 10
  let depth = 0

  while (nextPpid && depth < MAX_DEPTH) {
    if (nextPpid === ancestorPid) return true

    currentPid = nextPpid
    nextPpid = await getParentPid(currentPid)
    depth++
  }

  return false
}

async function killProjectProcessesOnPorts(): Promise<{
  killed: number[]
  failed: number[]
}> {
  const portResults = await checkAllPorts()
  const killed: number[] = []
  const failed: number[] = []

  for (const result of portResults) {
    if (result.inUse && result.belongsToProject && result.processInfo) {
      const isSpawnedByUs = await isDescendant(
        result.processInfo.pid,
        process.pid,
        result.processInfo.ppid,
      )

      if (isSpawnedByUs) {
        logger.log(
          `Skipping process on port ${result.port} (PID: ${result.processInfo.pid}) as it is a descendant of this process`,
        )
        continue
      }

      const success = await killProcess(result.processInfo.pid)
      if (success) {
        killed.push(result.port)
        logger.log(
          `Killed project process on port ${result.port} (PID: ${result.processInfo.pid})`,
        )
      } else {
        failed.push(result.port)
      }
    }
  }

  return { killed, failed }
}

export async function checkAndHandlePortConflicts(): Promise<{
  ready: boolean
  conflicts: PortCheckResult[]
  killedPorts: number[]
}> {
  logger.log('Checking port availability...')

  const portResults = await checkAllPorts()
  const occupiedPorts = portResults.filter((r) => r.inUse)

  if (occupiedPorts.length === 0) {
    logger.log('✅ All required ports are available.')
    return { ready: true, conflicts: [], killedPorts: [] }
  }

  const externalProcesses = occupiedPorts.filter((r) => !r.belongsToProject)

  const { killed, failed } = await killProjectProcessesOnPorts()

  if (failed.length > 0) {
    logger.warn(
      `⚠️  Failed to kill project processes on ports: ${failed.join(', ')}`,
    )
  }

  if (killed.length > 0) {
    logger.log(
      `✅ Killed stale project processes on ports: ${killed.join(', ')}`,
    )

    // Wait a bit for ports to be released
    await new Promise((resolve) =>
      setTimeout(() => {
        resolve(0)
      }, 1000),
    )
  }

  // Check if there are still external processes blocking ports
  if (externalProcesses.length > 0) {
    logger.warn('\n⚠️  PORT CONFLICT DETECTED!')
    logger.warn('The following ports are in use by external processes:\n')

    externalProcesses.forEach((conflict) => {
      logger.warn(`  Port ${conflict.port}:`)
      logger.warn(`    PID: ${conflict.processInfo?.pid}`)
      logger.warn(`    Process: ${conflict.processInfo?.processName}`)
      if (conflict.processInfo?.commandLine) {
        logger.warn(`    Command: ${conflict.processInfo.commandLine}`)
      }
      logger.warn('')
    })

    logger.warn('⚠️  WARNING: External processes are using required ports.')
    logger.warn('This may cause service failures when starting services.\n')
    logger.warn('To kill these processes manually:')

    if (isWindows) {
      externalProcesses.forEach((conflict) => {
        logger.warn(`  taskkill /PID ${conflict.processInfo?.pid} /F`)
      })
    } else {
      externalProcesses.forEach((conflict) => {
        logger.warn(`  kill -9 ${conflict.processInfo?.pid}`)
      })
    }

    logger.warn('\nContinuing startup anyway...\n')

    return {
      ready: true,
      conflicts: externalProcesses,
      killedPorts: killed,
    }
  }

  return {
    ready: true,
    conflicts: [],
    killedPorts: killed,
  }
}

// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { exec } from 'child_process'
import { promisify } from 'util'
import os from 'os'
import { ALLOWED_PORTS } from './constants'
import path from 'path'
import { logger } from '@/utils/logger'

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

/**
 * Get the project root directory
 */
function getProjectRoot(): string {
  // Navigate up from frontend/src/lib to project root
  return path.resolve(
    __dirname,
    process.env.NODE_ENV !== 'production'
      ? '../../../../../../../'
      : '../../../../',
  )
}

/**
 * Allowed process identifiers for this project
 * This is an explicit allowlist of processes that belong to this project
 */
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

/**
 * Normalize path separators for cross-platform comparison
 */
function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

/**
 * Check if a string contains a whole word match (case-insensitive)
 * Uses a safe approach without dynamic regex construction from untrusted input
 */
function containsWholeWord(haystack: string, needle: string): boolean {
  const haystackLower = haystack.toLowerCase()
  const needleLower = needle.toLowerCase()

  // Find all occurrences of the needle
  let index = haystackLower.indexOf(needleLower)

  while (index !== -1) {
    const beforeChar = index > 0 ? haystack[index - 1] : ' '
    const afterChar =
      index + needle.length < haystack.length
        ? haystack[index + needle.length]
        : ' '

    // Check if it's a word boundary (not alphanumeric or underscore)
    const isWordBoundaryBefore = !/[a-zA-Z0-9_]/.test(beforeChar)
    const isWordBoundaryAfter = !/[a-zA-Z0-9_]/.test(afterChar)

    if (isWordBoundaryBefore && isWordBoundaryAfter) {
      return true
    }

    // Search for next occurrence
    index = haystackLower.indexOf(needleLower, index + 1)
  }

  return false
}

/**
 * Check if a process belongs to this project based on its command line
 * Uses an explicit allowlist approach for security
 */
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

  // Check 3: Verify it's in the workers directory or uses allowed frameworks
  const workersPath = path.join(projectRoot, 'workers')
  const workersPathNormalized = normalizePath(workersPath)

  const inWorkersDirectory = cmdNormalized.includes(workersPathNormalized)

  const hasAllowedScript = ALLOWED_PROCESS_IDENTIFIERS.scriptNames.some(
    (script) => containsWholeWord(commandLine, script),
  )

  const hasAllowedFramework = ALLOWED_PROCESS_IDENTIFIERS.frameworkMarkers.some(
    (marker) => containsWholeWord(commandLine, marker),
  )

  // Must be in workers directory OR use allowed scripts/frameworks
  if (!inWorkersDirectory && !hasAllowedScript && !hasAllowedFramework) {
    return false
  }

  // All security checks passed
  return true
}

/**
 * Get process information for a specific port on Windows
 */
async function getPortInfoWindows(port: number): Promise<PortInfo | null> {
  try {
    // Use netstat to find the PID
    const { stdout } = await execPromise(
      `netstat -ano | findstr :${port} | findstr LISTENING`,
    )

    if (!stdout.trim()) return null

    // Parse netstat output to get PID
    const lines = stdout.trim().split('\n')
    const pidMatch = lines[0].match(/\s+(\d+)\s*$/)
    if (!pidMatch) return null

    const pid = parseInt(pidMatch[1])

    // Get process name and command line using WMIC
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
        ppid: ppidMatch ? parseInt(ppidMatch[1].trim()) : undefined,
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

/**
 * Get process information for a specific port on Unix/Linux/Mac
 */
async function getPortInfoUnix(port: number): Promise<PortInfo | null> {
  try {
    // Use lsof to find the process
    const { stdout } = await execPromise(`lsof -i :${port} -sTCP:LISTEN -t`)

    if (!stdout.trim()) return null

    const pid = parseInt(stdout.trim().split('\n')[0])

    // Get process details
    const { stdout: psOut } = await execPromise(
      `ps -p ${pid} -o ppid=,comm=,command=`,
    )

    const parts = psOut.trim().split(/\s+/)
    const ppid = parseInt(parts[0])
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
    // Exit code 1 means no process is listening - this is expected, not an error
    return null
  }
}

/**
 * Check if a specific port is in use and get process information
 */
export async function checkPort(port: number): Promise<PortCheckResult> {
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
 * Check all ports defined in ALLOWED_PORTS
 */
export async function checkAllPorts(): Promise<PortCheckResult[]> {
  const results = await Promise.all(
    ALLOWED_PORTS.map((port) => checkPort(port)),
  )
  return results
}

/**
 * Kill a process by PID
 */
export async function killProcess(pid: number): Promise<boolean> {
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

/**
 * Get the parent process ID of a given PID
 */
async function getParentPid(pid: number): Promise<number | null> {
  try {
    if (isWindows) {
      const { stdout } = await execPromise(
        `wmic process where ProcessId=${pid} get ParentProcessId /format:value`,
      )
      const match = stdout.match(/ParentProcessId=(\d+)/)
      return match ? parseInt(match[1]) : null
    } else {
      const { stdout } = await execPromise(`ps -p ${pid} -o ppid=`)
      const trimmed = stdout.trim()
      return trimmed ? parseInt(trimmed) : null
    }
  } catch {
    return null
  }
}

/**
 * Check if a process is a descendant of another process
 */
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

    // Prepare for next iteration
    currentPid = nextPpid
    nextPpid = await getParentPid(currentPid)
    depth++
  }

  return false
}

/**
 * Kill all project-related processes occupying the required ports
 */
export async function killProjectProcessesOnPorts(): Promise<{
  killed: number[]
  failed: number[]
}> {
  const portResults = await checkAllPorts()
  const killed: number[] = []
  const failed: number[] = []

  for (const result of portResults) {
    if (result.inUse && result.belongsToProject && result.processInfo) {
      // Check if the process was spawned by the current process (or its descendants)
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

/**
 * Check ports and prompt user if non-project processes are occupying them
 */
export async function checkAndHandlePortConflicts(): Promise<{
  ready: boolean
  conflicts: PortCheckResult[]
  killedPorts: number[]
}> {
  logger.log('Checking port availability...')

  // Check all ports
  const portResults = await checkAllPorts()
  const occupiedPorts = portResults.filter((r) => r.inUse)

  if (occupiedPorts.length === 0) {
    logger.log('✅ All required ports are available.')
    return { ready: true, conflicts: [], killedPorts: [] }
  }

  // Separate project and non-project processes
  const externalProcesses = occupiedPorts.filter((r) => !r.belongsToProject)

  // Kill project processes automatically
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
    logger.warn('This may cause service failures when starting workloads.\n')
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

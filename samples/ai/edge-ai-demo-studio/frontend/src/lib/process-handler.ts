// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type ChildProcess, spawn } from 'node:child_process'
import fs, { promises as fsPromises } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { createStream } from 'rotating-file-stream'
import treeKill from 'tree-kill'
import config from '@payload-config'
import { getPayload } from 'payload'
import { logger } from '@/lib/logger'
import { LOGS_DIR } from './constants'

async function getHfToken(): Promise<string> {
  try {
    const payload = await getPayload({ config })
    const settings = await payload.findGlobal({
      slug: 'app-settings',
      overrideAccess: true,
    })
    return settings.hfToken ?? process.env.HF_TOKEN ?? ''
  } catch {
    return process.env.HF_TOKEN ?? ''
  }
}

const isWindows = os.platform() === 'win32'
const START_SCRIPT = isWindows ? 'start.ps1' : 'start.sh'

const LOG_ROTATION_CONFIG = {
  size: '50M' as const,
  interval: '7d' as const,
  maxFiles: 10,
  compress: 'gzip' as const,
  path: LOGS_DIR,
}

const MAX_ARCHIVE_BYTES = 1 * 1024 * 1024

type ProcessStatus = 'active' | 'error' | 'stopped'
type ProcessEntry = {
  proc: ChildProcess
  startTime: Date
  status: ProcessStatus
  logStream?: ReturnType<typeof createStream>
}

// Persist across Next.js hot reloads
declare global {
  var processHandlerProcesses: Map<string, ProcessEntry> | undefined
  var processHandlerLogStreams:
    | Map<string, ReturnType<typeof createStream>>
    | undefined
  var processHandlerPendingSpawns: Set<string> | undefined
}

const processes =
  globalThis.processHandlerProcesses ?? new Map<string, ProcessEntry>()
globalThis.processHandlerProcesses ??= processes

// Tracks names that are currently mid-spawn (after the guard check but before
// processes.set()). Prevents a second concurrent call from bypassing the guard
// during the async log/token operations before the process is registered.
const pendingSpawns: Set<string> =
  globalThis.processHandlerPendingSpawns ?? new Set<string>()
globalThis.processHandlerPendingSpawns ??= pendingSpawns

const logStreams =
  globalThis.processHandlerLogStreams ??
  new Map<string, ReturnType<typeof createStream>>()
globalThis.processHandlerLogStreams ??= logStreams

// --- Log stream helpers ---

function closeLogStream(name: string): boolean {
  const stream = logStreams.get(name)
  if (!stream) return false
  stream.end()
  logStreams.delete(name)
  return true
}

function getLogStream(processName: string): ReturnType<typeof createStream> {
  const existing = logStreams.get(processName)
  if (existing) return existing

  const stream = createStream(`${processName}.log`, {
    ...LOG_ROTATION_CONFIG,
  })
  stream.on('error', (error) => {
    logger.error(`Log stream error for ${processName}:`, error)
  })
  logStreams.set(processName, stream)
  return stream
}

function createLogEntry(
  type: 'out' | 'info' | 'error',
  message: string,
  processName: string,
  pid?: number,
) {
  return `${JSON.stringify({
    timestamp: new Date().toISOString(),
    process: processName,
    pid: pid || null,
    type,
    message: message.toString().trim(),
  })}\n`
}

async function writeToLog(
  processName: string,
  logEntry: string,
): Promise<void> {
  try {
    getLogStream(processName).write(logEntry)
  } catch (error) {
    logger.error(`Failed to write to log stream for ${processName}:`, error)
    const logFile = path.join(LOGS_DIR, `${processName}.log`)
    try {
      await fsPromises.appendFile(logFile, logEntry)
    } catch (fallbackError) {
      logger.error(
        `Failed to write to fallback log file ${logFile}:`,
        fallbackError,
      )
    }
  }
}

// --- Log archival ---

async function drainLogStream(name: string): Promise<void> {
  const stream = logStreams.get(name)
  if (!stream) return
  await new Promise<void>((resolve) => {
    stream.once('finish', resolve)
    stream.once('close', resolve)
    try {
      stream.end()
    } catch {
      resolve()
    }
  })
  logStreams.delete(name)
}

async function capFileSize(filePath: string, maxBytes: number): Promise<void> {
  const fileUrl = pathToFileURL(filePath)
  const stats = await fsPromises.stat(fileUrl)
  if (stats.size <= maxBytes) return

  const start = stats.size - maxBytes
  const tmpUrl = pathToFileURL(`${filePath}.tmp`)
  const readOld = fs.createReadStream(fileUrl, { start })
  const tmpWrite = fs.createWriteStream(tmpUrl, { flags: 'w' })
  await pipeline(readOld, tmpWrite)
  await fsPromises.rename(tmpUrl, fileUrl)
}

async function archiveProcessLogs(name: string): Promise<void> {
  const logFilePath = path.join(LOGS_DIR, `${name}.log`)
  const oldLogsDirPath = path.join(LOGS_DIR, 'old')
  const oldLogFilePath = path.join(oldLogsDirPath, `${name}.log`)

  await drainLogStream(name)

  // Only treat ENOENT as "nothing to archive"; rethrow other errors
  let stats: fs.Stats
  try {
    stats = await fsPromises.stat(pathToFileURL(logFilePath))
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  if (stats.size === 0) return

  await fsPromises.mkdir(pathToFileURL(oldLogsDirPath), { recursive: true })

  // Stream-append current logs into the archive (avoids buffering entire file)
  const readStream = fs.createReadStream(pathToFileURL(logFilePath))
  const writeStream = fs.createWriteStream(pathToFileURL(oldLogFilePath), {
    flags: 'a',
  })
  try {
    await pipeline(readStream, writeStream)
  } catch (err) {
    logger.error(`Failed streaming logs for ${name}:`, err)
    throw err
  }

  await fsPromises.truncate(pathToFileURL(logFilePath), 0)

  try {
    await capFileSize(oldLogFilePath, MAX_ARCHIVE_BYTES)
  } catch (capErr) {
    logger.error(`Failed to cap archived log for ${name}:`, capErr)
  }
}

// --- Process cleanup helpers ---

function cleanupProcessEntry(name: string): void {
  closeLogStream(name)
  processes.delete(name)
}

function killProcessTree(proc: ChildProcess, name: string): void {
  if (!proc.pid) return

  if (!isWindows) {
    try {
      process.kill(-proc.pid, 'SIGTERM')
    } catch (err) {
      logger.error(`Failed to SIGTERM process group for ${name}:`, err)
    }
  } else {
    treeKill(proc.pid, 'SIGTERM', (err) => {
      if (err) {
        logger.error(`Failed to SIGTERM process tree for ${name}:`, err)
      }
    })
  }
}

// --- Public API ---

function init() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true })
  }
}

async function spawnProcess(
  name: string,
  args: Array<string> = [],
  options: {
    cwd: string
    env?: Record<string, string | undefined>
    /** Override the default start script with a custom executable. */
    command?: string
  },
) {
  if (processes.has(name) || pendingSpawns.has(name)) {
    logger.warn(`[${name}] is already running.`)
    return processes.get(name)
  }

  pendingSpawns.add(name)

  let command: string
  let spawnArgs: string[]

  if (options.command) {
    command = options.command
    spawnArgs = args
  } else {
    const startScript = path.join(options.cwd, START_SCRIPT)
    if (!fs.existsSync(startScript)) {
      logger.error(`[${name}] Start script not found: ${startScript}`)
      pendingSpawns.delete(name)
      return
    }
    command = isWindows ? 'powershell' : 'bash'
    spawnArgs = isWindows
      ? [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          startScript,
          ...args,
        ]
      : [startScript, ...args]
  }

  await archiveProcessLogs(name)
  await writeToLog(
    name,
    createLogEntry(
      'info',
      `Starting process: ${name} with args: ${args.join(' ')}`,
      name,
    ),
  )

  const hfToken = await getHfToken()
  const proc = spawn(command, spawnArgs, {
    env: {
      ...process.env,
      ...(hfToken ? { HF_TOKEN: hfToken } : {}),
      ...options.env,
    },
    cwd: options.cwd,
    detached: !isWindows,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (!isWindows) proc.unref()
  logger.log(`[${name}] started with PID ${proc.pid}`)

  proc.stdout?.on('data', async (data) => {
    await writeToLog(
      name,
      createLogEntry('out', data.toString(), name, proc.pid),
    )
  })

  proc.stderr?.on('data', async (data) => {
    await writeToLog(
      name,
      createLogEntry('error', data.toString(), name, proc.pid),
    )
  })

  proc.on('exit', async (code) => {
    await writeToLog(
      name,
      createLogEntry('out', `Process exited with code ${code}`, name, proc.pid),
    )
    logger.log(`[${name}] exited with code ${code}`)
    const entry = processes.get(name)
    if (entry) entry.status = 'stopped'
  })

  proc.on('error', async (err) => {
    await writeToLog(
      name,
      createLogEntry(
        'error',
        `Failed to start: ${err.message}`,
        name,
        proc.pid,
      ),
    )
    logger.error(`[${name}] failed to start:`, err)
    const entry = processes.get(name)
    if (entry) entry.status = 'error'
  })

  processes.set(name, {
    proc,
    startTime: new Date(),
    status: 'active',
    logStream: getLogStream(name),
  })
  pendingSpawns.delete(name)
  return proc
}

async function runProcessCommand(
  name: string,
  args: Array<string> = [],
  options: {
    cwd: string
    command: string
    env?: Record<string, string | undefined>
  },
): Promise<boolean> {
  await writeToLog(
    name,
    createLogEntry(
      'info',
      `Running process command: ${options.command} ${args.join(' ')}`,
      name,
    ),
  )

  const hfToken = await getHfToken()
  const proc = spawn(options.command, args, {
    env: {
      ...process.env,
      ...(hfToken ? { HF_TOKEN: hfToken } : {}),
      ...options.env,
    },
    cwd: options.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  proc.stdout?.on('data', async (data) => {
    await writeToLog(
      name,
      createLogEntry('out', data.toString(), name, proc.pid),
    )
  })

  proc.stderr?.on('data', async (data) => {
    await writeToLog(
      name,
      createLogEntry('error', data.toString(), name, proc.pid),
    )
  })

  return new Promise((resolve) => {
    proc.on('exit', async (code) => {
      await writeToLog(
        name,
        createLogEntry(
          code === 0 ? 'out' : 'error',
          `Process command exited with code ${code}`,
          name,
          proc.pid,
        ),
      )
      resolve(code === 0)
    })

    proc.on('error', async (err) => {
      await writeToLog(
        name,
        createLogEntry(
          'error',
          `Process command failed: ${err.message}`,
          name,
          proc.pid,
        ),
      )
      resolve(false)
    })
  })
}

function getStatus(name: string) {
  const entry = processes.get(name)
  if (!entry) return null
  return {
    status: entry.status,
    pid: entry.proc.pid,
    startTime: entry.startTime,
  }
}

async function stopProcess(name: string): Promise<boolean> {
  logger.log('Stopping process:', name)
  const entry = processes.get(name)
  if (!entry) return false

  const { proc } = entry
  if (proc.killed || proc.exitCode !== null) {
    cleanupProcessEntry(name)
    return false
  }

  const pgid = isWindows ? undefined : proc.pid

  const forceKillGroup = () => {
    if (pgid) {
      try {
        process.kill(-pgid, 'SIGKILL')
      } catch {
        // ESRCH → the process group is already gone — that is the desired outcome.
      }
    }
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      // Failsafe: if exit/error never fires, force cleanup after 10 s.
      forceKillGroup()
      cleanupProcessEntry(name)
      resolve(false)
    }, 10000)

    const cleanup = (success: boolean) => {
      clearTimeout(timeout)
      forceKillGroup()
      cleanupProcessEntry(name)
      resolve(success)
    }

    proc.on('exit', () => cleanup(true))
    proc.on('error', () => cleanup(false))

    killProcessTree(proc, name)
  })
}

function listProcesses() {
  return Array.from(processes.entries()).map(
    ([name, { proc, startTime, status }]) => ({
      name,
      status,
      pid: proc.pid,
      startTime,
    }),
  )
}

async function getProcessLogs(name: string, limit?: number) {
  const logFile = path.join(LOGS_DIR, `${name}.log`)

  try {
    await fsPromises.access(logFile)
  } catch {
    return []
  }

  try {
    const logContent = await fsPromises.readFile(logFile, 'utf-8')
    return logContent
      .trim()
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return {
            timestamp: new Date().toISOString(),
            process: name,
            pid: null,
            type: 'unknown',
            message: line,
          }
        }
      })
      .slice(limit ? -limit : undefined)
  } catch (error) {
    logger.error(`Failed to read log file ${logFile}:`, error)
    return []
  }
}

async function clearProcessLogs(name: string) {
  const logFile = path.join(LOGS_DIR, `${name}.log`)

  try {
    closeLogStream(name)
    await fsPromises.access(logFile)
    await fsPromises.writeFile(logFile, '')
    return true
  } catch {
    return false
  }
}

async function killAllProcesses() {
  logger.log('Killing all processes...')
  for (const [name] of processes.entries()) {
    const entry = processes.get(name)
    if (!entry) continue
    if (entry.proc.killed || entry.proc.exitCode !== null) continue
    await stopProcess(name)
  }

  for (const stream of logStreams.values()) {
    stream.end()
  }
  logStreams.clear()
}

function removeDeadProcess(name: string): boolean {
  const entry = processes.get(name)
  if (!entry) return false

  cleanupProcessEntry(name)
  logger.log(`Removed dead process ${name} from process list`)
  return true
}

export {
  spawnProcess,
  runProcessCommand,
  getStatus,
  stopProcess,
  listProcesses,
  getProcessLogs,
  clearProcessLogs,
  closeLogStream,
  init,
  killAllProcesses,
  removeDeadProcess,
}

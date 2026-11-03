// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Registry of the app's worker and engine processes by `type@instanceId`: spawns them with the
 * app's environment, pipes output into `logs/<name>.log`, stops them with their process group.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import fs, { promises as fsPromises } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { createStream } from 'rotating-file-stream'
import treeKill from 'tree-kill'
import { LOGS_DIR, WORKER_DIR } from '@/lib/constants'
import { globalSingleton } from '@/lib/global-singleton'
import {
  toNumactlCpuList,
  toWindowsAffinityMask,
} from '@/lib/instances/cpu-affinity'
import { formatLogLine } from '@/lib/log-line'
import { logger } from '@/lib/logger'
import { APP_SETTINGS_DEFAULTS } from '@/lib/settings/app-settings'
import { readAppSettingsSafe } from '@/lib/settings/app-settings-store'
import { withLoopbackNoProxy } from '@/lib/workers/spawn-env'
import {
  parseStartupLine,
  STARTUP_EVENTS_ENV,
  type StartupEvent,
} from '@/lib/workers/startup-events'

const isWindows = os.platform() === 'win32'
const isLinux = os.platform() === 'linux'
const START_SCRIPT = isWindows ? 'start.ps1' : 'start.sh'
/** Windows' `numactl -C`: runs a start script under a CPU affinity mask. */
const PIN_SCRIPT = path.join(WORKER_DIR, 'scripts', 'run-pinned.ps1')

const LOG_ROTATION_CONFIG = {
  size: '50M' as const,
  interval: '7d' as const,
  maxFiles: 10,
  compress: 'gzip' as const,
  path: LOGS_DIR,
}

const MAX_ARCHIVE_BYTES = 1 * 1024 * 1024

/** A buffered partial line longer than this is written out as it is. */
const MAX_PENDING_LINE = 64 * 1024

/** What the registry knows about a process it started. */
export type ProcessStatus = 'active' | 'error' | 'stopped'

type LogStream = ReturnType<typeof createStream>

interface ProcessEntry {
  proc: ChildProcess
  startTime: Date
  status: ProcessStatus
  logStream?: LogStream
}

export interface ProcessInfo {
  name: string
  status: ProcessStatus
  pid: number | undefined
  startTime: Date
}

/** How `spawnProcess` went. */
export type SpawnResult =
  | { kind: 'spawned'; pid: number | undefined }
  /** A process of that name is already registered (or being spawned). */
  | { kind: 'already-running' }
  /** Nothing was started, e.g. the worker has no start script. */
  | { kind: 'failed'; error: string }

// Kept across hot reloads and the separately bundled routes of `next dev`.
const processes = globalSingleton(
  'processHandlerProcesses',
  () => new Map<string, ProcessEntry>(),
)
// Names between the "already running" check and `processes.set()`, so a concurrent call cannot
// pass the check during the async work before registration.
const pendingSpawns = globalSingleton(
  'processHandlerPendingSpawns',
  () => new Set<string>(),
)
const logStreams = globalSingleton(
  'processHandlerLogStreams',
  () => new Map<string, LogStream>(),
)

// Log stream helpers

function closeLogStream(name: string): boolean {
  const stream = logStreams.get(name)
  if (!stream) return false
  stream.end()
  logStreams.delete(name)
  return true
}

function getLogStream(processName: string): LogStream {
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

async function writeToLog(
  processName: string,
  type: 'out' | 'info' | 'error',
  message: string,
  pid?: number,
): Promise<void> {
  const line = formatLogLine({ process: processName, pid, type, message })
  try {
    getLogStream(processName).write(line)
  } catch (error) {
    logger.error(`Failed to write to log stream for ${processName}:`, error)
    const logFile = path.join(LOGS_DIR, `${processName}.log`)
    try {
      await fsPromises.appendFile(logFile, line)
    } catch (fallbackError) {
      logger.error(
        `Failed to write to fallback log file ${logFile}:`,
        fallbackError,
      )
    }
  }
}

/** Appends a line of the app's own (e.g. a startup step) to a process's log. */
export function appendProcessLog(
  processName: string,
  type: 'info' | 'error',
  message: string,
): void {
  writeToLog(processName, type, message)
}

// Log archival

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

/**
 * Moves a log onto the end of the file of the same name in `old/` beside it
 * (capped at `MAX_ARCHIVE_BYTES`), leaving it empty for the next run.
 */
async function archiveLogFile(logFilePath: string): Promise<void> {
  const oldLogsDirPath = path.join(path.dirname(logFilePath), 'old')
  const oldLogFilePath = path.join(oldLogsDirPath, path.basename(logFilePath))

  // Only ENOENT means "nothing to archive"; anything else is an error.
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
  await pipeline(
    fs.createReadStream(pathToFileURL(logFilePath)),
    fs.createWriteStream(pathToFileURL(oldLogFilePath), { flags: 'a' }),
  )
  await fsPromises.truncate(pathToFileURL(logFilePath), 0)

  try {
    await capFileSize(oldLogFilePath, MAX_ARCHIVE_BYTES)
  } catch (capErr) {
    logger.error(`Failed to cap archived log ${oldLogFilePath}:`, capErr)
  }
}

/** The `*.log` files in `dir`; none while it does not exist. */
async function logFilesIn(dir: string): Promise<string[]> {
  try {
    const entries = await fsPromises.readdir(pathToFileURL(dir), {
      withFileTypes: true,
    })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.log'))
      .map((entry) => path.join(dir, entry.name))
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

/**
 * Archives `logs/<name>.log` and the `*.log` files in `logDir` so a new run starts empty. A log that
 * cannot be archived (locked on Windows) must not block the start; the new run appends to it.
 */
async function archiveProcessLogs(name: string, logDir?: string) {
  await drainLogStream(name)
  const files = [path.join(LOGS_DIR, `${name}.log`)]
  try {
    if (logDir) files.push(...(await logFilesIn(logDir)))
  } catch (error) {
    logger.error(`[${name}] could not list the logs in ${logDir}:`, error)
  }
  for (const file of files) {
    try {
      await archiveLogFile(file)
    } catch (error) {
      logger.error(`[${name}] could not archive ${file}:`, error)
    }
  }
}

// Process cleanup helpers

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

// Spawn helpers

/**
 * Pipes stdout/stderr into the log one entry per line; `\r` breaks lines too, so a progress bar is
 * one entry per update. With `onStartupEvent`, startup reports on stdout go there instead.
 */
function attachLogPipes(
  proc: ChildProcess,
  name: string,
  onStartupEvent?: (event: StartupEvent) => void,
): void {
  const pipe = (
    stream: NodeJS.ReadableStream | null,
    type: 'out' | 'error',
  ) => {
    if (!stream) return
    let pending = ''
    const write = (line: string) => {
      if (!line.trim()) return
      const event =
        onStartupEvent && type === 'out' ? parseStartupLine(line) : null
      if (event) onStartupEvent?.(event)
      else writeToLog(name, type, line, proc.pid)
    }
    stream.on('data', (chunk: Buffer | string) => {
      const lines = (pending + chunk.toString()).split(/\r\n|\r|\n/)
      pending = lines.pop() ?? ''
      lines.forEach(write)
      if (pending.length > MAX_PENDING_LINE) {
        write(pending)
        pending = ''
      }
    })
    stream.on('end', () => {
      write(pending)
      pending = ''
    })
  }
  pipe(proc.stdout, 'out')
  pipe(proc.stderr, 'error')
}

/**
 * The app's environment plus the saved HF token, the startup timeout (so workers wait as long as the
 * watchdog) and `extra`. `extra` must not repeat `process.env`, or it would override the settings.
 */
async function buildSpawnEnv(
  extra?: Record<string, string | undefined>,
): Promise<NodeJS.ProcessEnv> {
  const settings = await readAppSettingsSafe()
  const hfToken = settings.hfToken || process.env.HF_TOKEN || ''
  const startupTimeout =
    settings.startupTimeout ?? APP_SETTINGS_DEFAULTS.startupTimeout
  return withLoopbackNoProxy({
    ...process.env,
    ...(hfToken ? { HF_TOKEN: hfToken } : {}),
    STARTUP_TIMEOUT: String(startupTimeout),
    ...extra,
  })
}

/** The command line for `args` run through the worker's start script (or `command`). */
function resolveLaunch(
  name: string,
  args: string[],
  options: { cwd: string; command?: string; cpuAffinity?: string },
): { command: string; args: string[] } | { error: string } {
  const affinity = toNumactlCpuList(options.cpuAffinity)
  // run-pinned.ps1 sets the mask, then runs the start script; the processes it starts inherit it.
  const windowsMask =
    affinity && isWindows && !options.command
      ? toWindowsAffinityMask(affinity)
      : null
  let command: string
  let spawnArgs: string[]

  if (options.command) {
    command = options.command
    spawnArgs = args
  } else {
    const startScript = path.join(options.cwd, START_SCRIPT)
    if (!fs.existsSync(startScript)) {
      return { error: `Start script not found: ${startScript}` }
    }
    command = isWindows ? 'powershell' : 'bash'
    spawnArgs = isWindows
      ? [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          ...(windowsMask ? [PIN_SCRIPT, windowsMask] : []),
          startScript,
          ...args,
        ]
      : [startScript, ...args]
  }

  if (affinity) {
    if (isLinux) {
      spawnArgs = ['-C', affinity, command, ...spawnArgs]
      command = 'numactl'
      logger.info(`[${name}] pinning to CPUs ${affinity} via numactl`)
    } else if (windowsMask) {
      logger.info(
        `[${name}] pinning to CPUs ${affinity} (affinity mask 0x${windowsMask})`,
      )
    } else {
      logger.warn(
        `[${name}] cpuAffinity ${affinity} only works on Linux and for Windows start scripts on CPUs 0-63 — ignoring`,
      )
    }
  }
  return { command, args: spawnArgs }
}

// Public API

export function init(): void {
  fs.mkdirSync(LOGS_DIR, { recursive: true })
}

/** Starts and registers a long-running process via the start script in `cwd`, or `command`. */
export async function spawnProcess(
  name: string,
  args: string[] = [],
  options: {
    cwd: string
    /** Variables to add to the environment `buildSpawnEnv` builds. */
    env?: Record<string, string | undefined>
    /** Override the default start script with a custom executable. */
    command?: string
    /** CPU cores in numactl -C format (`0-7`, `0,2,4`); Linux, and Windows for CPUs 0-63; ignored when invalid. */
    cpuAffinity?: string
    /** Receives the process's structured startup reports instead of the log; unset disables them. */
    onStartupEvent?: (event: StartupEvent) => void
    /** Where the process writes its own `*.log` files, archived with its log on each new run. */
    logDir?: string
  },
): Promise<SpawnResult> {
  if (processes.has(name) || pendingSpawns.has(name)) {
    logger.warn(`[${name}] is already running.`)
    return { kind: 'already-running' }
  }

  pendingSpawns.add(name)
  try {
    const launch = resolveLaunch(name, args, options)
    if ('error' in launch) {
      logger.error(`[${name}] ${launch.error}`)
      return { kind: 'failed', error: launch.error }
    }

    await archiveProcessLogs(name, options.logDir)
    await writeToLog(
      name,
      'info',
      `Starting process: ${name} with args: ${args.join(' ')}`,
    )

    const proc = spawn(
      /* turbopackIgnore: true */ launch.command,
      launch.args,
      {
        env: await buildSpawnEnv({
          ...options.env,
          // Unset (Node drops `undefined`) unless the caller reads them.
          [STARTUP_EVENTS_ENV]: options.onStartupEvent ? '1' : undefined,
        }),
        cwd: options.cwd,
        detached: !isWindows,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    if (!isWindows) proc.unref()
    logger.log(`[${name}] started with PID ${proc.pid}`)

    attachLogPipes(proc, name, options.onStartupEvent)

    proc.on('exit', (code) => {
      writeToLog(name, 'out', `Process exited with code ${code}`, proc.pid)
      logger.log(`[${name}] exited with code ${code}`)
      const entry = processes.get(name)
      if (entry) entry.status = 'stopped'
    })

    proc.on('error', (err) => {
      writeToLog(name, 'error', `Failed to start: ${err.message}`, proc.pid)
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
    return { kind: 'spawned', pid: proc.pid }
  } finally {
    pendingSpawns.delete(name)
  }
}

/** Runs a one-off command (a stop script) to completion, logging into `name`'s log. True on exit 0. */
export async function runProcessCommand(
  name: string,
  args: string[],
  options: {
    cwd: string
    command: string
    env?: Record<string, string | undefined>
  },
): Promise<boolean> {
  await writeToLog(
    name,
    'info',
    `Running process command: ${options.command} ${args.join(' ')}`,
  )
  try {
    const proc = spawn(options.command, args, {
      cwd: options.cwd,
      // Not `buildSpawnEnv`: it reads settings through Payload, and the boot clean-up runs stop
      // scripts from inside Payload's init, so it would wait forever.
      env: withLoopbackNoProxy({ ...process.env, ...options.env }),
      // A script that reads its input gets none instead of waiting for it.
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    attachLogPipes(proc, name)
    // No time limit: stop scripts take down docker stacks. 'exit', not 'close': a background child
    // the script leaves running may hold its output open.
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      proc.once('exit', resolve)
      proc.once('error', reject)
    })
    await writeToLog(
      name,
      exitCode === 0 ? 'out' : 'error',
      `Process command exited with code ${exitCode}`,
    )
    return exitCode === 0
  } catch (error) {
    await writeToLog(
      name,
      'error',
      `Process command failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    return false
  }
}

export function getStatus(name: string): Omit<ProcessInfo, 'name'> | null {
  const entry = processes.get(name)
  if (!entry) return null
  return {
    status: entry.status,
    pid: entry.proc.pid,
    startTime: entry.startTime,
  }
}

export async function stopProcess(name: string): Promise<boolean> {
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
        // ESRCH: the process group is already gone.
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

export function listProcesses(): ProcessInfo[] {
  return Array.from(processes.entries()).map(
    ([name, { proc, startTime, status }]) => ({
      name,
      status,
      pid: proc.pid,
      startTime,
    }),
  )
}

export async function killAllProcesses(): Promise<void> {
  logger.log('Killing all processes...')
  for (const [name, entry] of processes.entries()) {
    if (entry.proc.killed || entry.proc.exitCode !== null) continue
    await stopProcess(name)
  }

  for (const stream of logStreams.values()) {
    stream.end()
  }
  logStreams.clear()
}

export function removeDeadProcess(name: string): boolean {
  const entry = processes.get(name)
  if (!entry) return false

  cleanupProcessEntry(name)
  logger.log(`Removed dead process ${name} from process list`)
  return true
}

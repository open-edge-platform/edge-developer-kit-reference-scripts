// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { spawn, ChildProcess, exec } from 'child_process'
import fs from 'fs'
import { promises as fsPromises } from 'fs'
import path from 'path'
import { LOG_FILE_PATH, WORKER_DIR } from './constants'
import os from 'os'
import { createStream } from 'rotating-file-stream'

const isWindows = os.platform() === 'win32'
const COMMANDS = {
  uv: path.join(WORKER_DIR, 'thirdparty', 'uv', isWindows ? 'uv.exe' : 'uv'),
}

// Log rotation configuration
const LOG_ROTATION_CONFIG = {
  size: '50M' as const, // Rotate when file reaches 50MB
  interval: '7d' as const, // Rotate daily
  maxFiles: 10, // Keep maximum 10 rotated files
  compress: 'gzip' as const, // Compress rotated files
  path: LOG_FILE_PATH,
}

// Store child processes by name, with status and rotating stream
type ProcessStatus = 'active' | 'error' | 'stopped'
type ProcessEntry = {
  proc: ChildProcess
  startTime: Date
  status: ProcessStatus
  logStream?: ReturnType<typeof createStream>
}

// Use globalThis to persist processes and streams across hot reloads
declare global {
  var processHandlerProcesses: Map<string, ProcessEntry> | undefined
  var processHandlerLogStreams:
    | Map<string, ReturnType<typeof createStream>>
    | undefined
}

// Initialize or reuse existing processes map
const processes =
  globalThis.processHandlerProcesses ?? new Map<string, ProcessEntry>()
if (!globalThis.processHandlerProcesses) {
  globalThis.processHandlerProcesses = processes
}

// Initialize or reuse existing log streams map
const logStreams =
  globalThis.processHandlerLogStreams ??
  new Map<string, ReturnType<typeof createStream>>()
if (!globalThis.processHandlerLogStreams) {
  globalThis.processHandlerLogStreams = logStreams
}

function init() {
  // Use the logs directory at the project root
  if (!fs.existsSync(LOG_FILE_PATH)) {
    fs.mkdirSync(LOG_FILE_PATH, {
      recursive: true,
    })
  }
}

// Helper function to get or create a rotating log stream for a process
function getLogStream(processName: string): ReturnType<typeof createStream> {
  if (logStreams.has(processName)) {
    return logStreams.get(processName)!
  }

  const stream = createStream(`${processName}.log`, {
    size: LOG_ROTATION_CONFIG.size,
    interval: LOG_ROTATION_CONFIG.interval,
    maxFiles: LOG_ROTATION_CONFIG.maxFiles,
    compress: LOG_ROTATION_CONFIG.compress,
    path: LOG_FILE_PATH,
  })

  // Handle stream errors
  stream.on('error', (error) => {
    console.error(`Log stream error for ${processName}:`, error)
  })

  logStreams.set(processName, stream)
  return stream
}

// Helper function to create JSON log entry
function createLogEntry(
  type: 'out' | 'info' | 'error',
  message: string,
  processName: string,
  pid?: number,
) {
  return (
    JSON.stringify({
      timestamp: new Date().toISOString(),
      process: processName,
      pid: pid || null,
      type,
      message: message.toString().trim(),
    }) + '\n'
  )
}

// Helper function to write log entry to rotating file stream
async function writeToLog(
  processName: string,
  logEntry: string,
): Promise<void> {
  try {
    const stream = getLogStream(processName)
    stream.write(logEntry)
  } catch (error) {
    console.error(`Failed to write to log stream for ${processName}:`, error)
    // Fallback to direct file write
    const logFile = path.join(LOG_FILE_PATH, `${processName}.log`)
    try {
      await fsPromises.appendFile(logFile, logEntry)
    } catch (fallbackError) {
      console.error(
        `Failed to write to fallback log file ${logFile}:`,
        fallbackError,
      )
    }
  }
}

async function spawnProcess(
  name: string,
  commandType: 'uv',
  args: Array<string> = [],
  options: object = {},
) {
  if (processes.has(name)) {
    console.warn(`[${name}] is already running.`)
    return processes.get(name)
  }

  if (!(commandType in COMMANDS)) {
    console.error(`[${name}] Unknown command type: ${commandType}`)
    return
  }

  // Log process start
  const startLogEntry = createLogEntry(
    'info',
    // `Starting process: ${command} ${args.join(' ')}`,
    `Starting process: ${name} with args: ${args.join(' ')}`,
    name,
  )
  await writeToLog(name, startLogEntry)

  const proc = spawn(COMMANDS[commandType], args, {
    ...options,
    env: { ...process.env },
  })
  console.log(`[${name}] started with PID ${proc.pid}`)

  // Handle stdout - convert to JSON format and write to log
  proc.stdout?.on('data', async (data) => {
    const logEntry = createLogEntry('out', data.toString(), name, proc.pid)
    await writeToLog(name, logEntry)
  })

  // Handle stderr - convert to JSON format and write to same log
  proc.stderr?.on('data', async (data) => {
    const logEntry = createLogEntry('error', data.toString(), name, proc.pid)
    await writeToLog(name, logEntry)
  })

  proc.on('exit', async (code) => {
    const exitMessage = `Process exited with code ${code}`
    const logEntry = createLogEntry('out', exitMessage, name, proc.pid)
    await writeToLog(name, logEntry)
    console.log(`[${name}] exited with code ${code}`)
    const entry = processes.get(name)
    if (entry) {
      entry.status = 'stopped'
    }
  })

  proc.on('error', async (err) => {
    const errorMessage = `Failed to start: ${err.message}`
    const logEntry = createLogEntry('error', errorMessage, name, proc.pid)
    await writeToLog(name, logEntry)
    console.error(`[${name}] failed to start:`, err)
    const entry = processes.get(name)
    if (entry) {
      entry.status = 'error'
    }
  })

  processes.set(name, {
    proc,
    startTime: new Date(),
    status: 'active',
    logStream: getLogStream(name),
  })
  return proc
}

function getStatus(name: string) {
  const entry = processes.get(name)
  if (!entry) return null

  const { proc, startTime, status } = entry
  return {
    status,
    pid: proc.pid,
    startTime,
  }
}

async function stopProcess(name: string): Promise<boolean> {
  console.log('Stopping process:', name)
  const entry = processes.get(name)
  if (!entry) return false

  const { proc, logStream } = entry
  if (proc.killed || proc.exitCode !== null) {
    // Close log stream and cleanup
    if (logStream) {
      logStream.end()
      logStreams.delete(name)
    }
    processes.delete(name)
    return false
  }

  // Platform-specific process tree killing
  return new Promise((resolve) => {
    const cleanup = (success: boolean) => {
      // Close log stream and cleanup
      if (logStream) {
        logStream.end()
        logStreams.delete(name)
      }
      processes.delete(name)
      resolve(success)
    }

    proc.on('exit', () => cleanup(true))
    proc.on('error', () => cleanup(false))

    if (process.platform === 'win32') {
      // Use taskkill to kill the process tree on Windows
      exec(`taskkill /PID ${proc.pid} /T /F`, (err) => {
        if (err) {
          console.error(`Failed to kill process tree for ${name}:`, err)
          proc.kill('SIGKILL')
        }
      })
    } else {
      // On Unix, kill the process group
      if (!proc.pid) {
        return
      }
      try {
        process.kill(-proc.pid, 'SIGTERM')
        setTimeout(() => {
          try {
            if (!proc.pid) {
              return
            }
            process.kill(-proc.pid, 'SIGKILL')
          } catch {}
        }, 5000)
      } catch (error: unknown) {
        console.log(error)
        // Fallback to killing the process directly
        proc.kill('SIGTERM')
        setTimeout(() => {
          if (!proc.killed && proc.exitCode === null) {
            proc.kill('SIGKILL')
          }
        }, 5000)
      }
    }
  })
}

function listProcesses() {
  return Array.from(processes.entries()).map(
    ([name, { proc, startTime, status }]) => {
      return {
        name,
        status,
        pid: proc.pid,
        startTime,
      }
    },
  )
}

// Function to read and parse JSON logs
async function getProcessLogs(name: string, limit?: number) {
  const logFile = path.join(LOG_FILE_PATH, `${name}.log`)

  try {
    await fsPromises.access(logFile)
  } catch {
    // File doesn't exist
    return []
  }

  try {
    const logContent = await fsPromises.readFile(logFile, 'utf-8')
    const lines = logContent
      .trim()
      .split('\n')
      .filter((line) => line.trim())

    const logs = lines
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          // If line is not valid JSON, create a basic log entry
          return {
            timestamp: new Date().toISOString(),
            process: name,
            pid: null,
            type: 'unknown',
            message: line,
          }
        }
      })
      .slice(limit ? -limit : undefined) // Get last N entries if limit specified

    return logs
  } catch (error) {
    console.error(`Failed to read log file ${logFile}:`, error)
    return []
  }
}

// Function to clear logs for a specific process
async function clearProcessLogs(name: string) {
  const logFile = path.join(LOG_FILE_PATH, `${name}.log`)

  try {
    // Close existing stream if it exists
    const existingStream = logStreams.get(name)
    if (existingStream) {
      existingStream.end()
      logStreams.delete(name)
    }

    try {
      await fsPromises.access(logFile)
      await fsPromises.writeFile(logFile, '')
      return true
    } catch {
      // File doesn't exist
      return false
    }
  } catch (error) {
    console.error(`Failed to clear log file ${logFile}:`, error)
    return false
  }
}

// Function to close log stream for a specific process
function closeLogStream(name: string): boolean {
  const stream = logStreams.get(name)
  if (stream) {
    stream.end()
    logStreams.delete(name)
    return true
  }
  return false
}

async function killAllProcesses() {
  console.log('Killing all processes...')
  for (const [name] of processes.entries()) {
    const entry = processes.get(name)
    if (!entry) continue
    const { proc } = entry
    if (proc.killed || proc.exitCode !== null) continue
    await stopProcess(name)
  }

  // Close any remaining log streams
  for (const stream of logStreams.values()) {
    stream.end()
  }
  logStreams.clear()
}

// Function to remove dead processes from the list without trying to kill them
function removeDeadProcess(name: string): boolean {
  console.log('Removing dead process from list:', name)
  const entry = processes.get(name)
  if (!entry) return false

  const { logStream } = entry

  // Close log stream if it exists
  if (logStream) {
    logStream.end()
    logStreams.delete(name)
  }

  // Remove process from the list
  processes.delete(name)
  console.log(`Removed dead process ${name} from process list`)
  return true
}

export {
  spawnProcess,
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

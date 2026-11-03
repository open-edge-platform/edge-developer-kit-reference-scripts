// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Stats } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { type NextRequest, NextResponse } from 'next/server'
import { engineServers } from '@/engines/_generated/engines'
import { type ErrorBody, jsonError } from '@/lib/api/json'
import { LOGS_DIR } from '@/lib/constants'
import { parseInstanceKey } from '@/lib/instances/instances'
import { isServiceType } from '@/lib/instances/service-type'
import { logger } from '@/lib/logger'
import { withoutPollingEntries } from '@/services/common/logs/log-message'
import type { ApiLogEntry, ApiLogResponse } from '@/types/common'

const MAX_READ_SIZE = 64_000
const MAX_TAIL_BYTES = 1_048_576 // 1 MiB tail-read cap
const DEFAULT_TAIL_LINES = 500
const MAX_HIDDEN_PATHS = 16
const MAX_HIDDEN_PATH_LENGTH = 256

// Strict allowlist so a log name can't traverse paths.
function isValidLogName(name: string | null): name is string {
  if (!name) return false
  if (name.length === 0 || name.length > 255) return false
  if (name.startsWith('.')) return false
  if (name.includes('..')) return false
  // `@` separates a service type from an instance id (`text-generation@cpu`)
  const re = /^[A-Za-z0-9][A-Za-z0-9._@-]*$/
  return re.test(name)
}

function isValidSource(source: string | null): boolean {
  if (!source) return true // unspecified means current
  return source === 'old'
}

/**
 * The engine `id` names and the instance (`name`, a valid log name) whose
 * log it keeps; null unless both are what they claim.
 */
function engineLog(id: string, name: string) {
  const server = Object.hasOwn(engineServers, id) ? engineServers[id] : null
  const instance = parseInstanceKey(name)
  if (!server || !instance || !isServiceType(instance.type)) return null
  return {
    server,
    instance: { type: instance.type, instanceId: instance.instanceId },
  }
}

/** The JSON log lines among `lines`; anything else (a torn write) is skipped. */
function parseLogLines(lines: string[]): ApiLogEntry[] {
  const parsed: ApiLogEntry[] = []
  for (const line of lines) {
    try {
      const logEntry = JSON.parse(line)
      parsed.push({
        timestamp: logEntry.timestamp,
        message: logEntry.message,
        level: logEntry.level ?? logEntry.type,
      })
    } catch {
      // Not a complete JSON line.
    }
  }
  return parsed
}

/** A non-negative integer from a query param, else null. */
function parseOffset(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : null
}

// Reads a bounded chunk, trimmed to what was actually read.
async function readFileChunk(
  filePath: string,
  size: number,
  offset: number,
): Promise<Buffer> {
  const file = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(size)
    const { bytesRead } = await file.read(buffer, 0, size, offset)
    return buffer.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}

interface LogRead {
  logs: ApiLogEntry[]
  /** Of the last line read, kept or not: the cursor for the next poll. */
  timestamp: string | null
}

// Parses lines and drops successful requests to the hidden (polled) paths.
function readLogLines(lines: string[], hiddenPaths: string[]): LogRead {
  const parsed = parseLogLines(lines)
  return {
    logs: withoutPollingEntries(parsed, hiddenPaths),
    timestamp: parsed.length > 0 ? parsed[parsed.length - 1].timestamp : null,
  }
}

// Get last N entries from log file, and the offset just past the last complete line.
async function getLastLines(
  logFile: string,
  fileSize: number,
  lineCount: number,
  hiddenPaths: string[],
): Promise<LogRead & { offset: number }> {
  // Read backwards in bounded, doubling chunks so huge archives aren't loaded whole. Polling
  // noise can fill a window, so count the entries kept, not the lines.
  let readSize = Math.min(MAX_READ_SIZE, fileSize)
  for (;;) {
    const offset = fileSize - readSize
    const chunk = await readFileChunk(logFile, readSize, offset)

    // A window that doesn't start at byte 0 may begin mid-line: drop it.
    const firstNewline = offset > 0 ? chunk.indexOf(0x0a) : -1
    const start =
      offset > 0 ? (firstNewline === -1 ? chunk.length : firstNewline + 1) : 0
    const lines = chunk.toString('utf-8', start).split('\n').filter(Boolean)
    const read = readLogLines(lines, hiddenPaths)

    if (
      read.logs.length >= lineCount ||
      offset === 0 ||
      readSize >= MAX_TAIL_BYTES
    ) {
      // If the file has no trailing newline, leave the partial last line for the next poll.
      const lastNewline = chunk.lastIndexOf(0x0a)
      const tailOffset =
        lastNewline === -1 ? fileSize : offset + lastNewline + 1
      return { ...read, logs: read.logs.slice(-lineCount), offset: tailOffset }
    }
    readSize = Math.min(readSize * 2, MAX_TAIL_BYTES, fileSize)
  }
}

// Reads one bounded chunk and returns its complete lines, plus how many bytes they consumed.
async function getFilteredLogs(
  logFile: string,
  offset: number,
  readSize: number,
  sinceTime: number,
  hiddenPaths: string[],
): Promise<LogRead & { consumed: number }> {
  const chunk = await readFileChunk(logFile, readSize, offset)
  const lastNewline = chunk.lastIndexOf(0x0a)
  let consumed: number
  if (lastNewline !== -1) {
    consumed = lastNewline + 1
  } else if (chunk.length === MAX_READ_SIZE) {
    // A single line longer than one read: consume it so the cursor cannot stall.
    consumed = chunk.length
  } else {
    consumed = 0
  }

  if (consumed === 0) return { logs: [], timestamp: null, consumed: 0 }

  const lines = chunk.toString('utf-8', 0, consumed).split('\n').filter(Boolean)
  const recent = lines.filter((line) => {
    // Quick timestamp check before expensive JSON parsing; an engine's
    // Python logger writes a space after the colon.
    const timestampMatch = line.match(/"timestamp":\s*"([^"]+)"/)
    return (
      timestampMatch !== null &&
      new Date(timestampMatch[1]).getTime() >= sinceTime
    )
  })

  return { ...readLogLines(recent, hiddenPaths), consumed }
}

export async function GET(
  req: NextRequest,
): Promise<NextResponse<ApiLogResponse | ErrorBody>> {
  const url = new URL(req.url)
  const name = url.searchParams.get('name')

  if (!name) return jsonError(400, 'Missing required parameter: name')

  if (!isValidLogName(name)) {
    return jsonError(
      400,
      'Invalid log name. Allowed characters: letters, digits, dot, underscore, hyphen, @; must not start with dot or contain ".."',
    )
  }

  const source = url.searchParams.get('source')
  if (!isValidSource(source)) {
    return jsonError(400, 'Invalid source parameter')
  }

  // `engine=<id>`: the log that engine keeps on disk for the instance `name`.
  const engineId = url.searchParams.get('engine')
  const engine = engineId === null ? null : engineLog(engineId, name)
  if (engineId !== null && !engine) {
    return jsonError(
      400,
      'Invalid engine parameter: expected an engine id, and an instance key as the name',
    )
  }
  const since = url.searchParams.get('since')
  const offsetParam = url.searchParams.get('offset')

  if ((since && !offsetParam) || (!since && offsetParam)) {
    return jsonError(
      400,
      'Both timestamp and offset parameters are required when using pagination',
    )
  }

  const sinceTime = since ? new Date(since).getTime() : 0
  if (Number.isNaN(sinceTime)) {
    return jsonError(400, 'Invalid since parameter: expected a timestamp')
  }
  const offset = offsetParam ? parseOffset(offsetParam) : 0
  if (offset === null) {
    return jsonError(400, 'Invalid offset parameter: expected a byte offset')
  }
  // `hide=/healthcheck&hide=/v1/logs` leaves out successful GETs of those
  // paths: the health checks and log reads the app polls.
  const hiddenPaths = url.searchParams
    .getAll('hide')
    .filter((p) => p.startsWith('/') && p.length <= MAX_HIDDEN_PATH_LENGTH)
    .slice(0, MAX_HIDDEN_PATHS)

  try {
    const logFile = engine
      ? await engine.server.getLogFile(engine.instance, source === 'old')
      : source === 'old'
        ? path.join(LOGS_DIR, 'old', `${name}.log`)
        : path.join(LOGS_DIR, `${name}.log`)

    // No log yet (the process never ran): a 404 the log view shows as empty.
    let stat: Stats | null = null
    try {
      if (logFile) stat = await fs.stat(logFile)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    if (!logFile || !stat) return jsonError(404, 'Log file not found')

    if (!since && offset === 0) {
      const {
        logs,
        offset: tailOffset,
        timestamp,
      } = await getLastLines(
        logFile,
        stat.size,
        DEFAULT_TAIL_LINES,
        hiddenPaths,
      )

      return NextResponse.json({ logs, offset: tailOffset, timestamp })
    }

    if (offset >= stat.size) {
      return NextResponse.json({
        logs: [],
        offset: stat.size,
        timestamp: since,
      })
    }

    const readSize = Math.min(MAX_READ_SIZE, stat.size - offset)
    const { logs, timestamp, consumed } = await getFilteredLogs(
      logFile,
      offset,
      readSize,
      sinceTime,
      hiddenPaths,
    )

    const newTimestamp = timestamp ?? since

    return NextResponse.json({
      logs,
      offset: offset + consumed,
      timestamp: newTimestamp,
    })
  } catch (err) {
    logger.error('Error reading log file:', err)
    return jsonError(500, 'Failed to read the log file')
  }
}

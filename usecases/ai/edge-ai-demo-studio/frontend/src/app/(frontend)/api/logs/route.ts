// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { LOG_FILE_PATH } from '@/lib/constants'
import { LogEntry, LogResponse } from '@/types/log'
import { logger } from '@/utils/logger'

const MAX_READ_SIZE = 64_000 // 64KB
const DEFAULT_TAIL_LINES = 500

// Validate log name to prevent path traversal and disallowed chars
function isValidLogName(name: string | null): name is string {
  if (!name) return false
  if (name.length === 0 || name.length > 255) return false
  if (name.startsWith('.')) return false
  if (name.includes('..')) return false
  const re = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
  return re.test(name)
}

// Only allow explicit source values (currently only 'old' is supported)
function isValidSource(source: string | null): boolean {
  if (!source) return true // unspecified means current
  return source === 'old'
}

// Helper function to parse JSON log lines safely
function parseLogLines(lines: string[]): LogEntry[] {
  const parsed: LogEntry[] = []
  for (const line of lines) {
    try {
      const logEntry = JSON.parse(line)
      delete logEntry.pid
      parsed.push(logEntry)
    } catch {
      // Skip invalid JSON lines
      continue
    }
  }
  return parsed
}

// Helper function to read file content
async function readFileContent(
  filePath: string,
  size: number,
  offset = 0,
): Promise<string> {
  const file = await fs.open(filePath, 'r')
  const buffer = Buffer.alloc(size)
  await file.read(buffer, 0, size, offset)
  await file.close()
  return buffer.toString('utf-8')
}

// Get last N lines from log file
async function getLastLines(
  logFile: string,
  fileSize: number,
  lineCount: number,
): Promise<LogEntry[]> {
  // Read from the end of the file in bounded chunks to avoid loading
  // extremely large archive files into memory.
  const MAX_TAIL_READ = 4_194_304 // 4MB maximum tail read

  let readSize = Math.min(MAX_READ_SIZE, fileSize)
  let offset = Math.max(0, fileSize - readSize)

  let content = await readFileContent(logFile, readSize, offset)
  let allLines = content.split('\n').filter(Boolean)

  // Expand read window exponentially until we have enough lines or reach cap/start
  while (
    allLines.length < lineCount &&
    offset > 0 &&
    readSize < MAX_TAIL_READ
  ) {
    const nextReadSize = Math.min(readSize * 2, MAX_TAIL_READ, fileSize)
    offset = Math.max(0, fileSize - nextReadSize)
    content = await readFileContent(logFile, nextReadSize, offset)
    allLines = content.split('\n').filter(Boolean)
    readSize = nextReadSize
  }

  const lastLines = allLines.slice(-lineCount)
  return parseLogLines(lastLines)
}

// Get filtered logs based on timestamp
async function getFilteredLogs(
  logFile: string,
  offset: number,
  readSize: number,
  sinceTime: number,
): Promise<{ logs: LogEntry[]; actualReadSize: number }> {
  const content = await readFileContent(logFile, readSize, offset)
  const lines = content.split('\n').filter(Boolean)
  const filtered: LogEntry[] = []

  for (const line of lines) {
    // Quick timestamp check before expensive JSON parsing
    const timestampMatch = line.match(/"timestamp":"([^"]+)"/)
    if (!timestampMatch) continue

    const lineTime = new Date(timestampMatch[1]).getTime()
    if (lineTime < sinceTime) continue

    try {
      const logEntry = JSON.parse(line)
      filtered.push(logEntry)
    } catch {
      // Skip invalid JSON lines
      continue
    }
  }

  return { logs: filtered, actualReadSize: readSize }
}

export async function GET(
  req: NextRequest,
): Promise<NextResponse<LogResponse | { error: string }>> {
  const url = new URL(req.url)
  const name = url.searchParams.get('name')

  if (!name) {
    return NextResponse.json(
      { error: 'Missing required parameter: name' },
      { status: 400 },
    )
  }

  // Strict allowlist validation for `name` to prevent path traversal
  if (!isValidLogName(name)) {
    return NextResponse.json(
      {
        error:
          'Invalid log name. Allowed characters: letters, digits, dot, underscore, hyphen; must not start with dot or contain ".."',
      },
      { status: 400 },
    )
  }

  const source = url.searchParams.get('source')
  // Validate source against explicit allowlist
  if (!isValidSource(source)) {
    return NextResponse.json(
      { error: 'Invalid source parameter' },
      { status: 400 },
    )
  }

  const logFile =
    source === 'old'
      ? path.join(LOG_FILE_PATH, 'old', `${name}.log`)
      : path.join(LOG_FILE_PATH, `${name}.log`)
  const since = url.searchParams.get('since')
  const offsetParam = url.searchParams.get('offset')

  // Validate that if either timestamp or offset exists, both must exist
  if ((since && !offsetParam) || (!since && offsetParam)) {
    return NextResponse.json(
      {
        error:
          'Both timestamp and offset parameters are required when using pagination',
      },
      { status: 400 },
    )
  }

  const sinceTime = since ? new Date(since).getTime() : 0
  const offset = offsetParam ? parseInt(offsetParam) : 0

  try {
    // Check if file exists
    let stat
    try {
      stat = await fs.stat(logFile)
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        // File doesn't exist, return empty logs
        return NextResponse.json(
          {
            error: 'Log file not found',
          },
          { status: 404 },
        )
      }
      // Re-throw other errors
      throw err
    }

    // Return last N lines when no filtering is requested
    if (!since && offset === 0) {
      const logs = await getLastLines(logFile, stat.size, DEFAULT_TAIL_LINES)
      const newTimestamp =
        logs.length > 0 ? logs[logs.length - 1].timestamp : null

      return NextResponse.json({
        logs,
        offset: stat.size,
        timestamp: newTimestamp,
      })
    }

    // Return empty if offset exceeds file size
    if (offset >= stat.size) {
      return NextResponse.json({
        logs: [],
        offset: stat.size,
        timestamp: since,
      })
    }

    // Read and filter logs based on timestamp
    const readSize = Math.min(MAX_READ_SIZE, stat.size - offset)
    const { logs, actualReadSize } = await getFilteredLogs(
      logFile,
      offset,
      readSize,
      sinceTime,
    )

    const newTimestamp =
      logs.length > 0 ? (logs[logs.length - 1].timestamp ?? since) : since

    return NextResponse.json({
      logs,
      offset: offset + actualReadSize,
      timestamp: newTimestamp,
    })
  } catch (err) {
    logger.error('Error reading log file:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}

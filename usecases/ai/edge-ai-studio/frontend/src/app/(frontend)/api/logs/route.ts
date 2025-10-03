// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { LOG_FILE_PATH } from '@/lib/constants'

export interface LogEntry {
  timestamp: string
  message: string
  type: 'error' | 'out'
}

export interface LogResponse {
  logs: LogEntry[]
  offset: number
  timestamp: string | null
}

const MAX_READ_SIZE = 64_000 // 64KB
const DEFAULT_TAIL_LINES = 500

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
  const content = await readFileContent(logFile, fileSize)
  const allLines = content.split('\n').filter(Boolean)
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

  const logFile = path.join(LOG_FILE_PATH, `${name}.log`)
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
    console.error('Error reading log file:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { LogLevel } from '@/types/common'
import { LEADING_LEVEL } from './log-level'

export interface AccessLog {
  method: string
  path: string
  query: [string, string][]
  client: string
  protocol: string
  status: number
  statusText: string
}

const ACCESS_LINE =
  /^(?:(?:INFO|DEBUG|WARNING|WARN|ERROR):\s*)?(\S+) - "([A-Z]+) (\S+) (HTTP\/\d(?:\.\d)?)" ([1-5]\d{2})(?: (.*))?$/

/** Recognize access records only; arbitrary application messages stay intact. */
export function parseAccessLog(line: string): AccessLog | null {
  const match = ACCESS_LINE.exec(line.trim())
  if (!match) return null
  const [, client, method, target, protocol, status, statusText = ''] = match
  const question = target.indexOf('?')
  const path = question < 0 ? target : target.slice(0, question)
  return {
    method,
    path,
    query:
      question < 0 ? [] : [...new URLSearchParams(target.slice(question + 1))],
    // A forwarded IPv4 address is often represented as IPv6, with no real port.
    client: client.replace(/^::ffff:(?=\d+\.)/i, '').replace(/:0$/, ''),
    protocol,
    status: Number(status),
    statusText,
  }
}

/** The path of a polled URL (`/v1/logs?name=x` → `/v1/logs`), for matching. */
export function pollingPath(url: string): string {
  const path = url.split(/[?#]/, 1)[0]
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

/** A successful GET of one of `paths`; failures still say something. */
function isPollingRequest(line: string, paths: ReadonlySet<string>): boolean {
  const access = parseAccessLog(line)
  return (
    access !== null &&
    access.method === 'GET' &&
    access.status >= 200 &&
    access.status < 300 &&
    paths.has(pollingPath(access.path))
  )
}

/**
 * Entries without successful GETs of the polled `paths`. One process write can carry several lines,
 * so an entry goes only when polling was all it held.
 */
export function withoutPollingEntries<T extends { message?: string | null }>(
  entries: T[],
  paths: readonly string[],
): T[] {
  if (paths.length === 0) return entries
  const polled = new Set(paths.map(pollingPath))
  return entries.flatMap((entry) => {
    const message = entry.message ?? ''
    if (!message.includes('GET /')) return [entry]
    const kept = message
      .split('\n')
      .filter((line) => !isPollingRequest(line, polled))
      .join('\n')
    if (kept === message) return [entry]
    return kept.trim() ? [{ ...entry, message: kept }] : []
  })
}

/**
 * Removes a leading severity the row's badge already shows, keeping other levels, logger names,
 * timestamps and traceback indentation. The stored message stays intact for search.
 */
export function formatLogMessage(message: string, level: LogLevel): string {
  return message
    .split('\n')
    .map((line) => {
      const cleaned = line.replace(LEADING_LEVEL[level], '$1')
      return cleaned.trim() ? cleaned : line
    })
    .join('\n')
}

/** `14:05:21`, local time — a log row's time column. */
export function formatLogTime(value: string | number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

/** What leads a logger's line: `[…]` groups (OVMS), a timestamp and optional logger name, a level. */
const LINE_PREFIX =
  /^\s*(?:\[[^\]]*\]\s*)*(?:\d{4}-\d{2}-\d{2}[T ][\d:.,]+Z?\s*(?:[-|]\s*)?(?:[\w.]+\s*[-|]\s*)?)?(?:(?:ERROR|CRITICAL|FATAL|ERR)\b\s*[:|-]?\s*)?/i

/** Longest headline kept; the full line stays in the log itself. */
const HEADLINE_MAX = 300

/**
 * One readable line for an error entry: a traceback's final exception, else the first line, without
 * the prefixes the row already shows.
 */
export function errorHeadline(message: string): string {
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const traceback = lines.some((line) =>
    line.startsWith('Traceback (most recent call last):'),
  )
  const chosen = (traceback ? lines.at(-1) : lines[0]) ?? ''
  const headline = chosen.replace(LINE_PREFIX, '').trim() || chosen
  return headline.length > HEADLINE_MAX
    ? `${headline.slice(0, HEADLINE_MAX - 1)}…`
    : headline
}

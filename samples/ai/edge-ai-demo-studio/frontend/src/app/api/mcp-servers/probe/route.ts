// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

interface ProbeResult {
  online: boolean
  tools: McpTool[]
  error?: string
  serverInfo?: { name?: string; version?: string }
}

const PROBE_TIMEOUT = 5000

// Whitelist of header names allowed in outgoing MCP requests
const ALLOWED_HEADER_NAMES: ReadonlySet<string> = new Set([
  'content-type',
  'accept',
  'authorization',
  'mcp-session-id',
])

/**
 * Sanitize a header value by rebuilding it from only safe printable ASCII characters.
 * This prevents CRLF injection and breaks the taint chain for static analysis.
 */
function sanitizeHeaderValue(value: string): string {
  const codes: number[] = []
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    // Only allow printable ASCII (space 0x20 through tilde 0x7e)
    if (code >= 0x20 && code <= 0x7e) {
      codes.push(code)
    }
  }
  return String.fromCharCode(...codes)
}

/**
 * Build a safe header record: only whitelisted header names are included,
 * and all values are sanitized to prevent header injection.
 */
function buildSafeHeaders(entries: [string, string][]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of entries) {
    if (ALLOWED_HEADER_NAMES.has(name.toLowerCase())) {
      result[name] = sanitizeHeaderValue(value)
    }
  }
  return result
}

function offlineResult(error: string): ProbeResult {
  return { online: false, tools: [], error }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { url?: string; apiKey?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(offlineResult('Invalid JSON body'), {
      status: 400,
    })
  }

  const { url, apiKey } = body
  if (!url || typeof url !== 'string') {
    return NextResponse.json(offlineResult('Missing url'), { status: 400 })
  }

  // Only allow http/https localhost or private network URLs to prevent SSRF
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return NextResponse.json(offlineResult('Invalid URL'), { status: 400 })
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return NextResponse.json(offlineResult('Only HTTP(S) URLs are allowed'), {
      status: 400,
    })
  }

  const hostname = parsed.hostname
  const isLocalOrPrivate =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)

  if (!isLocalOrPrivate) {
    return NextResponse.json(
      offlineResult('Only local/private network URLs are allowed'),
      { status: 400 },
    )
  }

  try {
    const result = await probeMcpServer(parsed, apiKey)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    logger.error(`MCP probe failed for ${parsed.href}:`, message)
    return NextResponse.json(offlineResult(message))
  }
}

async function probeMcpServer(
  validatedUrl: URL,
  apiKey?: string,
): Promise<ProbeResult> {
  const url = validatedUrl.href

  // Build base header entries with only whitelisted names
  const baseEntries: [string, string][] = [
    ['Content-Type', 'application/json'],
    ['Accept', 'application/json, text/event-stream'],
  ]
  if (apiKey) {
    if (!/^[\x20-\x7e]+$/.test(apiKey)) {
      return offlineResult('Invalid API key format')
    }
    baseEntries.push(['Authorization', `Bearer ${apiKey}`])
  }
  const headers = buildSafeHeaders(baseEntries)

  // Step 1: Initialize
  const initPayload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'demo-studio', version: '1.0.0' },
    },
  }

  const initRes = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(initPayload),
    signal: AbortSignal.timeout(PROBE_TIMEOUT),
  })

  if (!initRes.ok) {
    return offlineResult(`Server returned ${initRes.status}`)
  }

  // Extract session ID from response header if present
  const rawSessionId = initRes.headers.get('mcp-session-id')
  const initData = await parseJsonRpcResponse(initRes)

  const serverInfo = initData?.result?.serverInfo as
    { name?: string; version?: string } | undefined

  // Build headers for subsequent requests — include session ID only if it passes validation
  const sessionEntries: [string, string][] = [...baseEntries]
  if (rawSessionId && /^[\x20-\x7e]+$/.test(rawSessionId)) {
    sessionEntries.push(['mcp-session-id', rawSessionId])
  }
  const sessionHeaders = buildSafeHeaders(sessionEntries)

  // Step 2: Send initialized notification
  const notifPayload = {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  }

  await fetch(url, {
    method: 'POST',
    headers: sessionHeaders,
    body: JSON.stringify(notifPayload),
    signal: AbortSignal.timeout(PROBE_TIMEOUT),
  })

  // Step 3: List tools
  const toolsPayload = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  }

  const toolsRes = await fetch(url, {
    method: 'POST',
    headers: sessionHeaders,
    body: JSON.stringify(toolsPayload),
    signal: AbortSignal.timeout(PROBE_TIMEOUT),
  })

  if (!toolsRes.ok) {
    return {
      online: true,
      tools: [],
      serverInfo,
      error: `tools/list returned ${toolsRes.status}`,
    }
  }

  const toolsData = await parseJsonRpcResponse(toolsRes)
  const rawTools = toolsData?.result?.tools
  const toolsArray = Array.isArray(rawTools) ? rawTools : []
  const tools: McpTool[] = toolsArray.map(
    (t: {
      name?: string
      description?: string
      inputSchema?: Record<string, unknown>
    }) => ({
      name: t.name ?? 'unknown',
      description: t.description,
      inputSchema: t.inputSchema,
    }),
  )

  return { online: true, tools, serverInfo }
}

async function parseJsonRpcResponse(
  res: Response,
): Promise<{ result?: Record<string, unknown> } | null> {
  const contentType = res.headers.get('content-type') ?? ''

  if (contentType.includes('text/event-stream')) {
    // Parse SSE — look for the first data line containing a JSON-RPC result
    const text = await res.text()
    for (const line of text.split('\n')) {
      if (line.startsWith('data:')) {
        try {
          return JSON.parse(line.slice(5).trim())
        } catch {
          continue
        }
      }
    }
    return null
  }

  // Plain JSON
  try {
    return await res.json()
  } catch {
    return null
  }
}

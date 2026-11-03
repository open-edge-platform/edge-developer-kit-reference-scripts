// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import config from '@payload-config'
import { createMCPClient, type MCPClient } from '@ai-sdk/mcp'
import { type NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { z } from 'zod'
import { jsonError, parseJsonBody } from '@/lib/api/json'
import { getErrorMessage } from '@/lib/errors'
import { checkMcpServerUrl } from '@/lib/llm/mcp-url'
import { logger } from '@/lib/logger'
import { safeUrl, URL_CHARS } from '@/lib/validation'

export const dynamic = 'force-dynamic'

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

const PROBE_TIMEOUT_MS = 5000

/** A stored server's `id` (its key never reaches the browser), or a typed URL and key. */
const probeSchema = z.union([
  z.object({ id: z.number().int().positive() }),
  z.object({ url: z.string(), apiKey: z.string().nullish() }),
])

/** An API key that is safe in a header: printable ASCII only. */
const API_KEY_PATTERN = /^[\x20-\x7e]+$/

/** Connects, lists the tools and disconnects, within `PROBE_TIMEOUT_MS`. */
async function probeMcpServer(url: URL, apiKey?: string): Promise<ProbeResult> {
  const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS)
  let client: MCPClient | undefined
  try {
    client = await createMCPClient({
      transport: {
        type: 'http',
        url: url.href,
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        // Every request goes to a URL rebuilt from allowed characters.
        fetch: (input, init) => {
          let target = ''
          for (const ch of safeUrl(String(input))) {
            let ok = ''
            for (const allowed of URL_CHARS)
              if (allowed === ch) {
                ok = allowed
                break
              }
            if (!ok) throw new Error('Forbidden character in URL')
            target += ok
          }
          return fetch(target, init)
        },
      },
      clientName: 'edge-ai-demo-studio',
      initializationOptions: { signal },
    })
    const { tools } = await client.listTools({ options: { signal } })
    const { name, version } = client.serverInfo
    return {
      online: true,
      serverInfo: { name, version },
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    }
  } catch (error) {
    logger.debug(`MCP probe failed for ${url.href}:`, error)
    return {
      online: false,
      tools: [],
      error: signal.aborted
        ? `No answer within ${PROBE_TIMEOUT_MS / 1000} s`
        : getErrorMessage(error, 'The server did not answer'),
    }
  } finally {
    await client?.close().catch(() => undefined)
  }
}

/**
 * Probes an MCP server: `{ online, tools, serverInfo?, error? }`. An address outside the MCP address
 * policy, a malformed key or an unknown `id` is a 400/404 `{ error }`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const parsed = await parseJsonBody(request, probeSchema)
  if (!parsed.ok) return parsed.response

  let rawUrl: string
  let apiKey: string | undefined
  if ('id' in parsed.data) {
    const payload = await getPayload({ config })
    // The local API reads the stored (decrypted) key.
    const server = await payload.findByID({
      collection: 'mcp-servers',
      id: parsed.data.id,
      disableErrors: true,
    })
    if (!server) return jsonError(404, 'MCP server not found')
    rawUrl = server.url
    apiKey = server.apiKey || undefined
  } else {
    rawUrl = parsed.data.url
    apiKey = parsed.data.apiKey?.trim() || undefined
  }

  const checked = checkMcpServerUrl(rawUrl)
  if (!checked.ok) return jsonError(400, checked.error)
  if (apiKey && !API_KEY_PATTERN.test(apiKey)) {
    return jsonError(400, 'Invalid API key format')
  }

  return NextResponse.json(await probeMcpServer(checked.url, apiKey))
}

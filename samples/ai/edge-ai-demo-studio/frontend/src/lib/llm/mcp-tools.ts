// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { createMCPClient, type MCPClient } from '@ai-sdk/mcp'
import type { ToolSet } from 'ai'
import config from '@payload-config'
import { getPayload } from 'payload'
import type { ChatTools } from '@/lib/llm/chat-stream'
import { checkMcpServerUrl } from '@/lib/llm/mcp-url'
import { logger } from '@/lib/logger'

type McpTool = ToolSet[string]

const isTextPart = (part: unknown): part is { type: 'text'; text: string } =>
  typeof part === 'object' &&
  part !== null &&
  (part as { type?: unknown }).type === 'text' &&
  typeof (part as { text?: unknown }).text === 'string'

/** A text-only result reaches the model as that text, not as a JSON array of MCP content parts. */
function withTextResults(tool: McpTool): McpTool {
  type Options = { toolCallId: string; input: unknown; output: unknown }
  const toModelOutput = tool.toModelOutput as
    ((options: Options) => unknown) | undefined
  return {
    ...tool,
    toModelOutput: (options: Options) => {
      const content = (options.output as { content?: unknown } | undefined)
        ?.content
      if (
        Array.isArray(content) &&
        content.length > 0 &&
        content.every(isTextPart)
      ) {
        return {
          type: 'text' as const,
          value: content.map((part) => part.text).join('\n'),
        }
      }
      return toModelOutput
        ? toModelOutput(options)
        : { type: 'json' as const, value: options.output }
    },
  } as McpTool
}

const toolPrefix = (serverName: string) =>
  serverName.replace(/[^A-Za-z0-9_-]+/g, '_')

/**
 * Tools from the selected MCP servers; a name several servers offer becomes `<server>__<tool>`.
 * Disabled, disallowed or unreachable servers are left out.
 */
export async function buildMcpTools(
  serverIds: number[],
  { textResults = false }: { textResults?: boolean } = {},
): Promise<ChatTools> {
  const payload = await getPayload({ config })
  // The local API reads `apiKey` (decrypted) although REST never shows it.
  const { docs: servers } = await payload.find({
    collection: 'mcp-servers',
    where: { id: { in: serverIds } },
    limit: serverIds.length,
  })

  const offered: { server: string; name: string; tool: McpTool }[] = []
  const clients: MCPClient[] = []

  for (const server of servers) {
    if (server.disabled) continue
    const checked = checkMcpServerUrl(server.url)
    if (!checked.ok) {
      logger.warn(`MCP server ${server.name} skipped: ${checked.error}`)
      continue
    }

    try {
      const mcpClient = await createMCPClient({
        transport: {
          type: 'http',
          url: checked.url.href,
          headers: server.apiKey
            ? { Authorization: `Bearer ${server.apiKey}` }
            : undefined,
        },
      })
      clients.push(mcpClient)

      for (const [name, tool] of Object.entries(await mcpClient.tools())) {
        offered.push({ server: server.name, name, tool })
      }
    } catch (error) {
      logger.error(`Failed to connect to MCP server ${server.name}:`, error)
    }
  }

  const offeredBy = new Map<string, number>()
  for (const { name } of offered) {
    offeredBy.set(name, (offeredBy.get(name) ?? 0) + 1)
  }
  const tools: ToolSet = {}
  for (const { server, name, tool } of offered) {
    const key =
      (offeredBy.get(name) ?? 0) > 1 ? `${toolPrefix(server)}__${name}` : name
    if (key !== name) {
      logger.info(`MCP tool ${name} of ${server} is named ${key}`)
    }
    tools[key] = textResults ? withTextResults(tool) : tool
  }

  return {
    tools,
    cleanup: async () => {
      await Promise.allSettled(clients.map((c) => c.close()))
    },
  }
}

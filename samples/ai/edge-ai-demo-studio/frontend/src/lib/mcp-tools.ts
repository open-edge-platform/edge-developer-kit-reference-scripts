// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { createMCPClient, type MCPClient } from '@ai-sdk/mcp'
import type { ToolSet } from 'ai'
import config from '@payload-config'
import { getPayload } from 'payload'
import { logger } from '@/lib/logger'

// Builds AI SDK tools from MCP servers, returns tools and cleanup function
export async function buildMcpTools(serverIds: number[]): Promise<{
  tools: ToolSet
  cleanup: () => Promise<void>
}> {
  if (serverIds.length === 0) return { tools: {}, cleanup: async () => {} }

  const payload = await getPayload({ config })
  const { docs: servers } = await payload.find({
    collection: 'mcp-servers',
    where: { id: { in: serverIds } },
    limit: serverIds.length,
  })

  const allTools: ToolSet = {}
  const clients: MCPClient[] = []

  for (const server of servers) {
    if (server.disabled) continue

    try {
      const mcpClient = await createMCPClient({
        transport: {
          type: 'http',
          url: server.url,
          headers: server.apiKey
            ? { Authorization: `Bearer ${server.apiKey}` }
            : undefined,
        },
      })
      clients.push(mcpClient)

      const tools = await mcpClient.tools()
      for (const [name, toolDef] of Object.entries(tools)) {
        allTools[`${server.name}__${name}`] = toolDef
      }
    } catch (error) {
      logger.error(`Failed to connect to MCP server ${server.name}:`, error)
    }
  }

  const cleanup = async () => {
    await Promise.allSettled(clients.map((c) => c.close()))
  }

  return { tools: allTools, cleanup }
}

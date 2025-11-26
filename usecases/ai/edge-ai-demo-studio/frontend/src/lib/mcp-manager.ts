// Server-side MCP Manager for API routes
// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ToolSet } from 'ai'
import { experimental_createMCPClient } from '@ai-sdk/mcp'
import { getActiveMcpServers } from './server-db-utils'
import { McpServer } from '@/payload-types'

interface ServerMCPConnection {
  url: string
  name: string
  client: Awaited<ReturnType<typeof experimental_createMCPClient>> | null
  isConnected: boolean
}

export interface ToolInfo {
  name: string
  description: string
}

class McpManager {
  private connections: Map<string, ServerMCPConnection> = new Map()
  private lastFetchTime: number = 0
  private cacheTimeout: number = 5 * 60 * 1000 // 5 minutes

  async ensureConnections(): Promise<void> {
    const now = Date.now()

    // Only refresh if cache is expired or no connections exist
    if (
      now - this.lastFetchTime < this.cacheTimeout &&
      this.connections.size > 0
    ) {
      return
    }

    const servers = await getActiveMcpServers()

    // Clean up old connections not in the current server list
    const currentUrls = new Set(servers.map((s) => s.url))
    for (const [url] of this.connections.entries()) {
      if (!currentUrls.has(url)) {
        await this.disconnectServer(url)
      }
    }

    // Connect to new servers
    for (const server of servers) {
      if (!this.connections.has(server.url)) {
        await this.connectToServer(server)
      }
    }

    this.lastFetchTime = now
  }

  private async connectToServer(server: McpServer): Promise<void> {
    try {
      const client = await experimental_createMCPClient({
        transport: {
          type: 'http',
          url: server.url,
          headers: server.apiKey
            ? {
                Authorization: 'Bearer ' + server.apiKey,
              }
            : {},
        },
        name: server.name,
      })

      const connection: ServerMCPConnection = {
        url: server.url,
        name: server.name,
        client,
        isConnected: true,
      }

      this.connections.set(server.url, connection)
    } catch (error) {
      console.error(`Failed to connect to MCP server ${server.name}:`, error)
      // set is connected to false in case of failure
      const connection: ServerMCPConnection = {
        url: server.url,
        name: server.name,
        client: null,
        isConnected: false,
      }
      this.connections.set(server.url, connection)
    }
  }

  private async disconnectServer(url: string): Promise<void> {
    const connection = this.connections.get(url)
    if (connection) {
      try {
        // Clean up client connection if needed
        this.connections.delete(url)
        console.log(`Disconnected from MCP server: ${connection.name}`)
      } catch (error) {
        console.error(`Error disconnecting from ${connection.name}:`, error)
      }
    }
  }

  async getAllTools(): Promise<ToolSet> {
    await this.ensureConnections()

    let allTools = {}

    for (const connection of this.connections.values()) {
      if (connection.isConnected && connection.client) {
        const connectionTools = await connection.client.tools()
        allTools = { ...allTools, ...connectionTools }
      }
    }

    return allTools
  }

  async getGroupedTools(): Promise<Record<string, Array<ToolInfo>>> {
    await this.ensureConnections()

    const groupedTools: Record<string, Array<ToolInfo>> = {}

    for (const connection of this.connections.values()) {
      if (connection.isConnected && connection.client) {
        const connectionTools = await connection.client.tools()
        const tools = Object.entries(connectionTools).map(([name, tool]) => ({
          name,
          description:
            (tool as { description?: string }).description || `Tool: ${name}`,
        }))
        groupedTools[connection.name] = tools
      }
    }

    return groupedTools
  }

  async getToolsByNames(toolNames: string[]): Promise<ToolSet> {
    const allTools = await this.getAllTools()
    const selectedTools: ToolSet = {}

    for (const toolName of toolNames) {
      if (allTools[toolName]) {
        selectedTools[toolName] = allTools[toolName]
      }
    }

    return selectedTools
  }

  async cleanup(): Promise<void> {
    const urls = Array.from(this.connections.keys())
    for (const url of urls) {
      await this.disconnectServer(url)
    }
  }

  getConnectionStatus(serverName: string): boolean {
    for (const connection of this.connections.values()) {
      if (connection.name === serverName) {
        return connection.isConnected
      }
    }
    return false
  }
}

let mcpManager: McpManager | null = null

export function getMcpManager(): McpManager {
  if (!mcpManager) {
    mcpManager = new McpManager()
  }
  return mcpManager
}

export { McpManager }

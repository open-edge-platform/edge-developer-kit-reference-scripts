// API route to get MCP server information and tools from server-side manager
// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { getMcpManager } from '@/lib/mcp-manager'
import { getActiveMcpServers } from '@/lib/server-db-utils'
import { logger } from '@/utils/logger'

// Get server-side MCP manager
const mcpManager = getMcpManager()

export async function GET() {
  try {
    // Get server configurations from database
    const serverConfigs = await getActiveMcpServers()

    // Get grouped tools (this also ensures connections internally)
    const groupedTools = await mcpManager.getGroupedTools()

    // Calculate total tools efficiently
    let totalTools = 0

    // Build server information with single iteration
    const servers = serverConfigs.map((config) => {
      const serverTools = groupedTools[config.name] || []
      totalTools += serverTools.length
      const isConnected = mcpManager.getConnectionStatus(config.name)

      return {
        id: config.id.toString(),
        name: config.name,
        url: config.url,
        active: true, // If it's in the manager, it's active
        isConnected,
        toolCount: serverTools.length,
        tools: serverTools,
      }
    })

    return Response.json({
      servers,
      totalTools,
      lastUpdate: new Date().toISOString(),
    })
  } catch (error) {
    logger.error('Error getting MCP server info:', error)
    // Cleanup all clients
    await mcpManager.cleanup()
    return Response.json(
      { error: 'Failed to get MCP server information' },
      { status: 500 },
    )
  }
}

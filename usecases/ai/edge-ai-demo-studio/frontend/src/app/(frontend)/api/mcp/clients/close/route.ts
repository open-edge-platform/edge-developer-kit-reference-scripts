// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { getMcpManager } from '@/lib/mcp-manager'

export async function POST() {
  try {
    // Get server-side MCP manager
    const mcpManager = getMcpManager()

    // Cleanup all clients
    await mcpManager.cleanup()

    console.log('Successfully cleaned up all MCP clients')

    return Response.json({
      success: true,
      message: 'All MCP clients have been cleaned up',
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error cleaning up MCP clients:', error)
    return Response.json(
      {
        success: false,
        error: 'Failed to cleanup MCP clients',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}

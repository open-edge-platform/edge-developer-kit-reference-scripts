import { getMcpManager } from '@/lib/mcp-manager'
import { ToolSet } from 'ai'
import { logger } from './logger'

export const getMcpTools = async (tools: string[]): Promise<ToolSet> => {
  // Get MCP tools from server-side manager
  let mcpTools: ToolSet = {}

  try {
    const mcpManager = getMcpManager()

    if (tools && tools.length > 0) {
      // Get specific tools by names
      mcpTools = await mcpManager.getToolsByNames(tools)
    } else {
      // Get all available tools when no specific tools requested
      mcpTools = await mcpManager.getAllTools()
    }
  } catch (error) {
    logger.error('Error loading MCP tools:', error)
    // Continue without tools rather than failing completely
  } finally {
    return mcpTools
  }
}

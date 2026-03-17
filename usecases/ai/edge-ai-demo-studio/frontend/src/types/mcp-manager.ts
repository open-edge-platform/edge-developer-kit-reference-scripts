export interface McpServerInfo {
  id: string
  name: string
  url: string
  active: boolean
  isConnected: boolean
  toolCount: number
  tools: ToolInfo[]
}

export interface ToolInfo {
  name: string
  description: string
}

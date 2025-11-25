// Simplified MCP server info hook using server-side manager
// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ToolInfo } from '@/lib/mcp-manager'

export interface McpServerInfo {
  id: string
  name: string
  url: string
  active: boolean
  isConnected: boolean
  toolCount: number
  tools: ToolInfo[]
}

export function useMcpServerInfo() {
  const queryClient = useQueryClient()
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Get initialization state from query cache (shared across all components)
  const isInitialized =
    (queryClient.getQueryData(['mcp-initialization-state']) as boolean) ?? false

  // Get MCP server and tool information from server-side manager
  // Only fetch when explicitly initialized
  const {
    data: serverInfo,
    isLoading: toolsLoading,
    error,
  } = useQuery({
    queryKey: ['mcp-clients'],
    queryFn: async (): Promise<{
      servers: McpServerInfo[]
      totalTools: number
    }> => {
      const response = await fetch('/api/mcp/clients')
      if (!response.ok) {
        throw new Error('Failed to fetch MCP server info')
      }
      return response.json()
    },
    enabled: isInitialized, // Only fetch when explicitly enabled
    // refetchInterval: isInitialized ? 30000 : false, // Only refresh when initialized
    // staleTime: 1000 * 60 * 5, // Consider data stale after 5 minutes
  })

  // Connect to MCP servers by fetching fresh data from database
  const refreshMcpData = useCallback(async () => {
    if (isRefreshing) return
    setIsRefreshing(true)

    try {
      // If not initialized yet, set it to initialized first
      if (!isInitialized) {
        queryClient.setQueryData(['mcp-initialization-state'], true)
      }

      // Force a fresh fetch from the database by invalidating the query
      // This will call /api/mcp/clients which reads from PayloadCMS database
      await queryClient.invalidateQueries({ queryKey: ['mcp-clients'] })

      // Wait for the query to refetch to ensure connection attempts are made
      await queryClient.refetchQueries({ queryKey: ['mcp-clients'] })

      toast.success('Successfully connected to MCP servers')
    } catch (error) {
      console.error('Error connecting to MCP servers:', error)
      toast.error('Failed to connect to MCP servers')
    } finally {
      setIsRefreshing(false)
    }
  }, [isRefreshing, isInitialized, queryClient])

  // Cleanup MCP clients on both server and client side
  const unloadMcpData = useCallback(async () => {
    try {
      // First cleanup server-side clients
      const response = await fetch('/api/mcp/clients/close', {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to cleanup MCP clients')
      }

      // Then clean up client-side state
      queryClient.setQueryData(['mcp-initialization-state'], false)
      queryClient.setQueryData(['mcp-clients'], null)
      queryClient.removeQueries({ queryKey: ['mcp-clients'] })

      toast.success('Successfully disconnected from MCP servers')
      return true
    } catch (error) {
      console.error('Error disconnecting from MCP servers:', error)

      // Still clean up client-side state even if server cleanup fails
      queryClient.setQueryData(['mcp-initialization-state'], false)
      queryClient.setQueryData(['mcp-clients'], null)
      queryClient.removeQueries({ queryKey: ['mcp-clients'] })

      toast.error('Failed to properly disconnect from MCP servers')
      return false
    }
  }, [queryClient])

  return {
    // Server information
    activeServers: serverInfo?.servers || [],
    totalTools: serverInfo?.totalTools || 0,

    // Loading states
    toolsLoading: toolsLoading || isRefreshing,
    isInitialized: isInitialized && !!serverInfo && !error,

    // Actions
    refreshMcpData,
    unloadMcpData,
  }
}

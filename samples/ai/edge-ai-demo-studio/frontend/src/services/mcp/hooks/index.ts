// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { McpServer } from '@/payload-types'

const QUERY_KEY = ['mcp-servers']
const PROBE_QUERY_KEY = ['mcp-server-probe']
const PROBE_POLL_INTERVAL = 30_000

export interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface McpProbeResult {
  online: boolean
  tools: McpTool[]
  error?: string
  serverInfo?: { name?: string; version?: string }
}

export function useMcpServers() {
  return useQuery<McpServer[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const url = new URL('/api/mcp-servers', window.location.origin)
      const res = await fetch(url)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      return data.docs ?? []
    },
  })
}

export function useCreateMcpServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (
      server: Omit<McpServer, 'id' | 'updatedAt' | 'createdAt'>,
    ) => {
      const url = new URL('/api/mcp-servers', window.location.origin)
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(server),
      })
      const text = await res.text()
      if (!res.ok) throw new Error(text)
      const data = JSON.parse(text)
      return data.doc as McpServer
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: PROBE_QUERY_KEY })
    },
  })
}

export function useUpdateMcpServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: number
      data: Partial<Omit<McpServer, 'id' | 'updatedAt' | 'createdAt'>>
    }) => {
      const url = new URL(`/api/mcp-servers/${id}`, window.location.origin)
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error(await res.text())
      const result = await res.json()
      return result.doc as McpServer
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: PROBE_QUERY_KEY })
    },
  })
}

export function useDeleteMcpServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const url = new URL(`/api/mcp-servers/${id}`, window.location.origin)
      const res = await fetch(url, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: PROBE_QUERY_KEY })
    },
  })
}

export function useMcpServersProbe(servers: McpServer[]) {
  const enabledServers = servers.filter((s) => !s.disabled)
  return useQuery<Record<number, McpProbeResult>>({
    queryKey: [
      ...PROBE_QUERY_KEY,
      'all',
      enabledServers.map((s) => s.id).join(','),
    ],
    queryFn: async () => {
      const results: Record<number, McpProbeResult> = {}
      await Promise.all(
        enabledServers.map(async (server) => {
          try {
            const url = new URL(
              '/api/mcp-servers/probe',
              window.location.origin,
            )
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: server.url, apiKey: server.apiKey }),
            })
            results[server.id] = res.ok
              ? await res.json()
              : {
                  online: false,
                  tools: [],
                  error: `Probe failed: ${res.status}`,
                }
          } catch {
            results[server.id] = { online: false, tools: [] }
          }
        }),
      )
      return results
    },
    enabled: enabledServers.length > 0,
    refetchInterval: PROBE_POLL_INTERVAL,
  })
}

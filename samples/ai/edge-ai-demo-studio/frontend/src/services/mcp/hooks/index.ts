// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { fetchJson, postJson } from '@/lib/browser/fetch-json'
import { getErrorMessage } from '@/lib/errors'
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

/** The API key is write-only: send a new one, `null` to remove it, or leave it out to keep it. */
export type McpServerInput = Omit<
  McpServer,
  'id' | 'updatedAt' | 'createdAt' | 'hasApiKey'
>

export function useMcpServers() {
  return useQuery<McpServer[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      // Every server: Payload would otherwise answer its first page of 10.
      const data = await fetchJson<{ docs?: McpServer[] }>(
        '/api/mcp-servers?limit=0',
      )
      return data.docs ?? []
    },
  })
}

/** After any change, the list and every probe are refetched. */
function useInvalidateMcp() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    queryClient.invalidateQueries({ queryKey: PROBE_QUERY_KEY })
  }
}

export function useCreateMcpServer() {
  const invalidate = useInvalidateMcp()
  return useMutation({
    mutationFn: async (server: McpServerInput) => {
      const data = await postJson<{ doc: McpServer }>(
        '/api/mcp-servers',
        server,
      )
      return data.doc
    },
    onSuccess: invalidate,
  })
}

export function useUpdateMcpServer() {
  const invalidate = useInvalidateMcp()
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: number
      data: Partial<McpServerInput>
    }) => {
      const result = await postJson<{ doc: McpServer }>(
        `/api/mcp-servers/${id}`,
        data,
        { method: 'PATCH' },
      )
      return result.doc
    },
    onSuccess: invalidate,
  })
}

export function useDeleteMcpServer() {
  const invalidate = useInvalidateMcp()
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson(`/api/mcp-servers/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}

/** Connects to a saved server (by id: the server reads its URL and key). */
async function probeServer(id: number): Promise<McpProbeResult> {
  try {
    return await postJson<McpProbeResult>('/api/mcp-servers/probe', { id })
  } catch (error) {
    return { online: false, tools: [], error: getErrorMessage(error) }
  }
}

/** What a connection test probes: a saved server, or an address being entered. */
export type McpProbeTarget = { id: number } | { url: string; apiKey?: string }

/**
 * Connects, lists the tools and disconnects, without saving. Resolves `online: false` when the
 * server did not answer; rejects only when the address is refused (MCP address policy, bad key).
 */
export function useTestMcpConnection() {
  return useMutation({
    mutationFn: (target: McpProbeTarget) =>
      postJson<McpProbeResult>('/api/mcp-servers/probe', target),
  })
}

/**
 * One probe per enabled server, so each row settles on its own. Keyed by id and last change, so a
 * re-addressed or re-keyed server is probed afresh. A server with no entry is still being checked.
 */
export function useMcpServersProbe(
  servers: McpServer[],
): Record<number, McpProbeResult> {
  const enabledServers = servers.filter((s) => !s.disabled)
  return useQueries({
    queries: enabledServers.map((server) => ({
      queryKey: [...PROBE_QUERY_KEY, server.id, server.updatedAt],
      queryFn: () => probeServer(server.id),
      refetchInterval: PROBE_POLL_INTERVAL,
    })),
    // Structurally shared by react-query: the same object while nothing
    // changed, so consumers can memoize on it.
    combine: (results) => {
      const probes: Record<number, McpProbeResult> = {}
      results.forEach((result, i) => {
        if (result.data) probes[enabledServers[i].id] = result.data
      })
      return probes
    },
  })
}

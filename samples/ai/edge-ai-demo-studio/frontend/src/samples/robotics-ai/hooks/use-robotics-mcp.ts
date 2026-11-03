// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { Tone } from '@/components/common/tones'
import { requireApiBase } from '@/lib/browser/api-base'
import { getErrorMessage } from '@/lib/errors'
import { connectMcp, ROBOTICS_SERVICE } from '../lib/api'
import { normalizeTools } from '../lib/mcp-tools'

export type McpStatus = 'connecting' | 'connected' | 'error'

const MCP_STATUS: Record<McpStatus, { label: string; tone: Tone }> = {
  connected: { label: 'MCP Connected', tone: 'success' },
  connecting: { label: 'MCP Connecting', tone: 'warning' },
  error: { label: 'MCP Error', tone: 'destructive' },
}

/** The worker's MCP server connection, the tools it offers, and which of them the chat may use. */
export function useRoboticsMcp(workerBaseUrl: string | undefined) {
  const connection = useMutation({
    mutationFn: () => {
      requireApiBase(workerBaseUrl, ROBOTICS_SERVICE)
      return connectMcp(workerBaseUrl)
    },
  })
  const { mutate: connect } = connection
  const [chosenToolId, setSelectedToolId] = useState('')
  const [useMcp, setUseMcp] = useState(true)

  // Connect once the worker is known, and again if it changes.
  useEffect(() => {
    if (workerBaseUrl) connect()
  }, [workerBaseUrl, connect])

  const status: McpStatus = connection.isError
    ? 'error'
    : connection.isSuccess
      ? 'connected'
      : 'connecting'
  const availableTools = connection.isSuccess
    ? normalizeTools(connection.data.tools)
    : []
  // A tool the server no longer offers falls back to "all tools".
  const selectedTool = availableTools.find((tool) => tool.id === chosenToolId)

  return {
    status,
    statusLabel: MCP_STATUS[status].label,
    statusTone: MCP_STATUS[status].tone,
    statusMessage: connection.isError
      ? getErrorMessage(connection.error, 'Failed to connect')
      : connection.isSuccess
        ? (connection.data.message ?? 'Connected to MCP server')
        : 'Connecting to MCP server…',
    availableTools,
    selectedToolId: selectedTool?.id ?? '',
    setSelectedToolId,
    selectedTool,
    connect: () => {
      if (!connection.isPending) connect()
    },
    useMcp,
    setUseMcp,
  }
}

export type RoboticsMcp = ReturnType<typeof useRoboticsMcp>

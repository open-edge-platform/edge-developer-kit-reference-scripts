// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMemo } from 'react'
import {
  useFeaturePublish,
  useSingletonGroup,
} from '@/context/feature-collector'
import { useMcpParams } from './hooks/use-mcp-params'

/**
 * Headless MCP feature provider (registered by codegen): adds the MCP Tools config group, and
 * `mcpServerIds` with the tool-call parser and result format to the chat request body.
 */
export function McpFeatureProvider() {
  const mcp = useMcpParams()

  const groups = useSingletonGroup(mcp.group)
  // Memoized on purpose: published from an effect (`useFeaturePublish`).
  const extraBody = useMemo(
    () =>
      mcp.enabled && mcp.selectedServerIds.length > 0
        ? {
            mcpServerIds: mcp.selectedServerIds,
            toolCallParser: mcp.toolCallParser,
            mcpTextResults: mcp.textResults,
          }
        : {},
    [mcp.enabled, mcp.selectedServerIds, mcp.toolCallParser, mcp.textResults],
  )

  useFeaturePublish('mcp', { groups, extraBody })

  return null
}

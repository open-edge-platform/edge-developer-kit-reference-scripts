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
 * Headless feature provider for the optional MCP integration. Auto-registered
 * into `featureProviderRegistry` by codegen; a host sample mounts it (via
 * `useFeatureProviders`) to surface the MCP Tools config group and contribute
 * `mcpServerIds` to the chat request body. See docs/OPTIONAL-SERVICES.md.
 */
export function McpFeatureProvider() {
  const mcp = useMcpParams()

  const groups = useSingletonGroup(mcp.group)
  const extraBody = useMemo(
    () =>
      mcp.enabled && mcp.selectedServerIds.length > 0
        ? { mcpServerIds: mcp.selectedServerIds }
        : {},
    [mcp.enabled, mcp.selectedServerIds],
  )

  useFeaturePublish('mcp', { groups, extraBody })

  return null
}

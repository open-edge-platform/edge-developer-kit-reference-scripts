// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMemo, useState } from 'react'
import { useMcpServers, useMcpServersProbe } from '.'
import {
  DEFAULT_TOOL_CALL_PARSER,
  TOOL_CALL_PARSER_OPTIONS,
  type ToolCallParserId,
} from '@/lib/llm/tool-call-parsers'
import type { ServiceParamGroup } from '@/types/demo-params'
import type { DemoParam } from '@/types/demo-params'

interface UseMcpParamsOptions {
  optional?: boolean
}

/**
 * Lives in the mcp folder so export prunes it with the service. `group` and `selectedServerIds` are
 * memoized so the feature provider can publish them without re-render churn.
 */
export function useMcpParams(options?: UseMcpParamsOptions) {
  const { optional = true } = options ?? {}
  const { data: servers = [] } = useMcpServers()
  const probeResults = useMcpServersProbe(servers)

  const [enabled, setEnabled] = useState(true)
  const [deselectedIds, setDeselectedIds] = useState<Set<number>>(new Set())
  const [toolCallParser, setToolCallParser] = useState<ToolCallParserId>(
    DEFAULT_TOOL_CALL_PARSER,
  )
  const [textResults, setTextResults] = useState(false)

  const enabledServers = useMemo(
    () => servers.filter((s) => !s.disabled),
    [servers],
  )

  const enabledServerIds = useMemo(
    () => new Set(enabledServers.map((s) => s.id)),
    [enabledServers],
  )

  const available = enabledServers.length > 0

  const toolParams: DemoParam[] = useMemo(
    () =>
      enabledServers
        .filter((s) => !deselectedIds.has(s.id))
        .flatMap((server) => {
          const probe = probeResults[server.id]
          if (!probe?.online || probe.tools.length === 0) return []
          return [
            {
              type: 'info-list' as const,
              id: `mcp-tools-${server.id}`,
              label: `${server.name} tools`,
              items: probe.tools.map((t) => ({
                name: t.name,
                description: t.description,
              })),
            },
          ]
        }),
    [enabledServers, deselectedIds, probeResults],
  )

  const params: DemoParam[] = useMemo(
    () =>
      available
        ? [
            {
              type: 'checkbox-group',
              id: 'mcp-servers',
              label: 'MCP Servers',
              options: enabledServers.map((s) => ({
                value: String(s.id),
                label: s.name,
                checked: !deselectedIds.has(s.id),
              })),
              onChange: (value: string, checked: boolean) => {
                const id = Number(value)
                setDeselectedIds((prev) => {
                  const next = new Set(prev)
                  if (checked) next.delete(id)
                  else next.add(id)
                  return next
                })
              },
            },
            {
              type: 'select',
              id: 'mcp-tool-parser',
              label: 'Tool Call Parser',
              advanced: true,
              tooltip:
                "How tool calls are read from the model. Hermes and Qwen3 Coder describe the tools in the system prompt and parse the calls from the answer text. Native leaves tool calling to the engine, mainly for llama.cpp models: llama.cpp reads the calls in the model's own chat template format (OpenVINO models need a tool parser set on the model).",
              value: toolCallParser,
              options: TOOL_CALL_PARSER_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
              })),
              onChange: (v) => {
                const option = TOOL_CALL_PARSER_OPTIONS.find(
                  (o) => o.value === v,
                )
                if (option) setToolCallParser(option.value)
              },
            },
            {
              type: 'toggle',
              id: 'mcp-text-results',
              label: 'Plain Text Tool Results',
              advanced: true,
              tooltip:
                "Gives the model a tool's text result as plain text instead of the MCP JSON list of content parts. Turn on if the model misreads or repeats the JSON.",
              checked: textResults,
              onChange: setTextResults,
            },
            ...toolParams,
          ]
        : [],
    [
      available,
      enabledServers,
      deselectedIds,
      toolParams,
      toolCallParser,
      textResults,
    ],
  )

  const group: ServiceParamGroup = useMemo(
    () => ({
      serviceLabel: 'MCP Tools',
      serviceId: 'mcp',
      online: true,
      optional,
      configHref: '/services/mcp',
      params,
      ...(optional ? { enabled, onToggle: setEnabled } : {}),
    }),
    [optional, params, enabled],
  )

  const selectedServerIds = useMemo(
    () => [...enabledServerIds].filter((id) => !deselectedIds.has(id)),
    [enabledServerIds, deselectedIds],
  )

  return {
    enabled: available && enabled,
    selectedServerIds,
    toolCallParser,
    textResults,
    group,
  }
}

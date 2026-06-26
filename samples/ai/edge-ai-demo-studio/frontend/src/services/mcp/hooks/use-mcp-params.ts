// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMemo, useState } from 'react'
import { useMcpServers, useMcpServersProbe } from '.'
import type { ServiceParamGroup } from '@/types/demo-params'
import type { DemoParam } from '@/types/demo-params'

interface UseMcpParamsOptions {
  optional?: boolean
}

/**
 * MCP optional-service integration. Lives in the mcp service folder so it is
 * pruned with the folder at export time. Identities (`group`, `selectedServerIds`)
 * are memoized so the feature-provider can publish them through the collector
 * without re-render churn — see docs/OPTIONAL-SERVICES.md.
 */
export function useMcpParams(options?: UseMcpParamsOptions) {
  const { optional = true } = options ?? {}
  const { data: servers = [] } = useMcpServers()
  const { data: probeResults = {} } = useMcpServersProbe(servers)

  const [enabled, setEnabled] = useState(true)
  const [deselectedIds, setDeselectedIds] = useState<Set<number>>(new Set())

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
            ...toolParams,
          ]
        : [],
    [available, enabledServers, deselectedIds, toolParams],
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
    group,
  }
}

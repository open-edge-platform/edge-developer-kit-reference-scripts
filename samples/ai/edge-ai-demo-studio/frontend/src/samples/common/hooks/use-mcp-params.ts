// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMemo, useState } from 'react'
import { useMcpServers, useMcpServersProbe } from '@/services/mcp/hooks'
import type { DemoParam } from '@/types/demo-params'
import type { ServiceParamGroup } from '../components/demo-config-sheet'

interface UseMcpParamsOptions {
  optional?: boolean
}

export function useMcpParams(options?: UseMcpParamsOptions) {
  const { optional = true } = options ?? {}
  const { data: servers = [] } = useMcpServers()
  const enabledServers = servers.filter((s) => !s.disabled)
  const { data: probeResults = {} } = useMcpServersProbe(servers)

  const [enabled, setEnabled] = useState(true)
  const [deselectedIds, setDeselectedIds] = useState<Set<number>>(new Set())

  const enabledServerIds = useMemo(
    () => new Set(enabledServers.map((s) => s.id)),
    [enabledServers],
  )

  const available = enabledServers.length > 0

  const toolParams: DemoParam[] = enabledServers
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
    })

  const params: DemoParam[] = available
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
    : []

  const group: ServiceParamGroup = {
    serviceLabel: 'MCP Tools',
    serviceId: 'mcp',
    online: true,
    optional,
    configHref: '/services/mcp',
    params,
    ...(optional
      ? {
          enabled,
          onToggle: setEnabled,
        }
      : {}),
  }

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

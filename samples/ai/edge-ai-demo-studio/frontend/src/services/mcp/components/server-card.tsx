// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ChevronDown, ChevronRight, Edit, Trash2, Wrench } from 'lucide-react'
import { TruncatedText } from '@/components/common/truncated-text'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { McpServer } from '@/payload-types'
import type { McpProbeResult } from '../hooks'
import { describeServerInfo } from './connection-outcome'
import { Availability } from './server-row'
import { ServerToolsGrid } from './server-tools-grid'

/** A server on a narrow screen: a card instead of a table row, so nothing needs sideways scrolling. */
export function ServerCard({
  server,
  probe,
  isExpanded,
  onToggleExpand,
  onToggleDisabled,
  onEdit,
  onDelete,
}: {
  server: McpServer
  probe: McpProbeResult | undefined
  isExpanded: boolean
  onToggleExpand: () => void
  onToggleDisabled: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const tools = probe?.tools ?? []
  const toolsId = `mcp-server-${server.id}-tools-card`
  const info = probe ? describeServerInfo(probe) : null
  const isProbing = !server.disabled && !probe

  return (
    <li
      className="bg-card space-y-3 rounded-lg border p-3"
      data-testid={`mcp-server-card-${server.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <TruncatedText
            text={server.name}
            className="text-foreground text-sm font-medium"
          />
          <TruncatedText
            text={server.url}
            className="text-muted-foreground font-mono text-xs"
          />
          {info && (
            <TruncatedText
              text={info}
              className="text-muted-foreground text-xs"
            />
          )}
        </div>
        <div className="shrink-0">
          <Availability server={server} probe={probe} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Switch
            checked={!server.disabled}
            onCheckedChange={onToggleDisabled}
            aria-label={`Enable ${server.name}`}
            className="data-[state=checked]:bg-success"
          />
          <span className="text-muted-foreground text-xs" aria-hidden="true">
            {server.disabled ? 'Disabled' : 'Enabled'}
          </span>
        </div>
        {server.disabled ? null : isProbing ? (
          <span className="text-muted-foreground text-xs">Checking tools…</span>
        ) : tools.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-xs"
            aria-expanded={isExpanded}
            aria-controls={isExpanded ? toolsId : undefined}
            onClick={onToggleExpand}
          >
            {isExpanded ? (
              <ChevronDown aria-hidden="true" />
            ) : (
              <ChevronRight aria-hidden="true" />
            )}
            <Wrench aria-hidden="true" />
            {isExpanded ? 'Hide' : 'Show'} {tools.length}{' '}
            {tools.length === 1 ? 'tool' : 'tools'}
          </Button>
        ) : (
          <span className="text-muted-foreground text-xs">No tools</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onEdit}
          aria-label={`Edit ${server.name}`}
        >
          <Edit aria-hidden="true" />
          Edit
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={onDelete}
          aria-label={`Delete ${server.name}`}
        >
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
      </div>

      {isExpanded && tools.length > 0 && (
        <ServerToolsGrid id={toolsId} tools={tools} />
      )}
    </li>
  )
}

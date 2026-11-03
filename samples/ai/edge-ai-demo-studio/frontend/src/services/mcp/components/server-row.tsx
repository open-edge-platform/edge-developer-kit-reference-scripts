// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Edit,
  Loader,
  Trash2,
  Wrench,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { TableCell, TableRow } from '@/components/ui/table'
import { TruncatedText } from '@/components/common/truncated-text'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { McpServer } from '@/payload-types'
import { cn } from '@/lib/utils'
import type { McpProbeResult } from '../hooks'
import { ServerToolsGrid } from './server-tools-grid'

/** Disabled, still being checked, online, or offline with the reason on hover/focus. */
export function Availability({
  server,
  probe,
}: {
  server: McpServer
  probe: McpProbeResult | undefined
}) {
  if (server.disabled) return <Badge variant="secondary">Disabled</Badge>
  if (!probe) {
    return (
      <Badge variant="outline" className="gap-1">
        <Loader aria-hidden="true" className="h-3 w-3 animate-spin" />
        Checking
      </Badge>
    )
  }
  if (probe.online) return <Badge tone="success">Online</Badge>
  const offline = (
    <Badge variant="destructive" className="gap-1">
      <CircleAlert aria-hidden="true" className="h-3 w-3" />
      Offline
    </Badge>
  )
  if (!probe.error) return offline
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="rounded-full"
          aria-label={`Offline: ${probe.error}`}
        >
          {offline}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="max-w-xs text-xs">{probe.error}</p>
      </TooltipContent>
    </Tooltip>
  )
}

/** One server: its status and tool count, and when expanded its tools. */
export function ServerRow({
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
  const isProbing = !server.disabled && !probe
  const tools = probe?.tools ?? []
  const hasTools = tools.length > 0
  const toolsId = `mcp-server-${server.id}-tools`

  return (
    <>
      <TableRow
        className={cn(hasTools && 'cursor-pointer', isExpanded && 'border-b-0')}
        // The row is a larger target for the pointer; keyboard users have
        // the expand button in its first cell.
        onClick={() => {
          if (hasTools) onToggleExpand()
        }}
      >
        <TableCell className="w-8 px-2">
          {hasTools && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-expanded={isExpanded}
              aria-controls={isExpanded ? toolsId : undefined}
              aria-label={`${isExpanded ? 'Hide' : 'Show'} the tools of ${server.name}`}
              onClick={(e) => {
                e.stopPropagation()
                onToggleExpand()
              }}
            >
              {isExpanded ? (
                <ChevronDown
                  aria-hidden="true"
                  className="text-muted-foreground"
                />
              ) : (
                <ChevronRight
                  aria-hidden="true"
                  className="text-muted-foreground"
                />
              )}
            </Button>
          )}
        </TableCell>
        <TableCell className="font-medium">
          <div>
            {server.name}
            {probe?.serverInfo?.name && (
              <span className="text-muted-foreground ml-2 text-xs">
                ({probe.serverInfo.name}
                {probe.serverInfo.version
                  ? ` v${probe.serverInfo.version}`
                  : ''}
                )
              </span>
            )}
          </div>
        </TableCell>
        <TableCell className="max-w-64 font-mono text-sm">
          <TruncatedText text={server.url} />
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Availability server={server} probe={probe} />
        </TableCell>
        <TableCell>
          {server.disabled ? (
            <span className="text-muted-foreground text-sm">—</span>
          ) : isProbing ? (
            <span className="text-muted-foreground text-sm">…</span>
          ) : (
            <Badge variant="outline" className="gap-1">
              <Wrench aria-hidden="true" className="h-3 w-3" />
              {tools.length}
              <span className="sr-only"> tools</span>
            </Badge>
          )}
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={!server.disabled}
            onCheckedChange={onToggleDisabled}
            aria-label={`Enable ${server.name}`}
            className="data-[state=checked]:bg-success"
          />
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-label={`Edit ${server.name}`}
              onClick={onEdit}
            >
              <Edit aria-hidden="true" className="h-4 w-4" />
            </Button>
            <Button
              variant="destructive"
              size="sm"
              aria-label={`Delete ${server.name}`}
              onClick={onDelete}
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {isExpanded && hasTools && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={7} className="bg-muted/30 px-6 py-3">
            <ServerToolsGrid id={toolsId} tools={tools} />
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

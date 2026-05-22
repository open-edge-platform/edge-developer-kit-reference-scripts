// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Edit,
  Loader2,
  Plus,
  Trash2,
  Wrench,
} from 'lucide-react'
import { getFirstSentence } from '@/lib/utils'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { McpServer } from '@/payload-types'
import type { Service } from '@/services/types'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { AddServerDialog } from './components/add-server-dialog'
import {
  type McpProbeResult,
  useCreateMcpServer,
  useDeleteMcpServer,
  useMcpServers,
  useMcpServersProbe,
  useUpdateMcpServer,
} from './hooks'

export function McpDemo(_props: { service: Service }) {
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingServer, setEditingServer] = useState<McpServer | undefined>()
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  const { data: servers = [], isLoading } = useMcpServers()
  const { data: probeResults = {} } = useMcpServersProbe(servers)
  const createMutation = useCreateMcpServer()
  const updateMutation = useUpdateMcpServer()
  const deleteMutation = useDeleteMcpServer()

  const toggleExpanded = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAddServer = (
    serverData: Omit<McpServer, 'id' | 'updatedAt' | 'createdAt'>,
  ) => {
    createMutation.mutate(serverData, {
      onSuccess: () => toast.success('MCP server added successfully'),
      onError: (err) =>
        toast.error(
          'Failed to add MCP server' +
            (err instanceof Error ? `: ${err.message}` : ''),
        ),
    })
  }

  const handleEditServer = (
    serverData: Omit<McpServer, 'id' | 'updatedAt' | 'createdAt'>,
  ) => {
    if (!editingServer) return
    updateMutation.mutate(
      { id: editingServer.id, data: serverData },
      {
        onSuccess: () => {
          toast.success('MCP server updated successfully')
          setEditingServer(undefined)
        },
        onError: () => toast.error('Failed to update MCP server'),
      },
    )
  }

  const handleDeleteServer = (serverId: number) => {
    deleteMutation.mutate(serverId, {
      onSuccess: () => toast.success('MCP server deleted successfully'),
      onError: (err) =>
        toast.error(
          'Failed to delete MCP server' +
            (err instanceof Error ? `: ${err.message}` : ''),
        ),
    })
  }

  const handleToggleDisabled = (server: McpServer) => {
    updateMutation.mutate(
      { id: server.id, data: { disabled: !server.disabled } },
      {
        onSuccess: () =>
          toast.success(
            `MCP server ${server.disabled ? 'enabled' : 'disabled'}`,
          ),
        onError: () => toast.error('Failed to toggle server status'),
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold">MCP Servers</h3>
            <div className="text-muted-foreground text-sm font-normal">
              Manage your Model Context Protocol servers and their
              configurations.
            </div>
          </div>

          <Button
            onClick={() => {
              setEditingServer(undefined)
              setShowAddDialog(true)
            }}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Server
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : servers.length === 0 ? (
          <div className="border-muted rounded-lg border-2 border-dashed p-8 text-center">
            <div className="bg-muted mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
              <Plus className="text-muted-foreground h-6 w-6" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">No MCP servers</h3>
            <p className="text-muted-foreground mx-auto mb-4 max-w-sm">
              Get started by adding your first MCP server to extend your AI
              capabilities.
            </p>
            <Button
              onClick={() => {
                setEditingServer(undefined)
                setShowAddDialog(true)
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Your First Server
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Name</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Availability</TableHead>
                  <TableHead>Tools</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {servers.map((server) => {
                  const probe = probeResults[server.id]
                  const isExpanded = expandedIds.has(server.id)
                  return (
                    <ServerRow
                      key={server.id}
                      server={server}
                      probe={probe}
                      isExpanded={isExpanded}
                      onToggleExpand={() => toggleExpanded(server.id)}
                      onToggleDisabled={() => handleToggleDisabled(server)}
                      onEdit={() => {
                        setEditingServer(server)
                        setShowAddDialog(true)
                      }}
                      onDelete={() => handleDeleteServer(server.id)}
                    />
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <AddServerDialog
          open={showAddDialog}
          onOpenChange={(open) => {
            setShowAddDialog(open)
            if (!open) {
              setEditingServer(undefined)
            }
          }}
          onSave={editingServer ? handleEditServer : handleAddServer}
          editingServer={editingServer}
        />
      </CardContent>
    </Card>
  )
}

function ServerRow({
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
  const isDisabled = server.disabled
  const isProbing = !isDisabled && !probe
  const isOnline = probe?.online ?? false
  const tools = probe?.tools ?? []
  const hasTools = tools.length > 0

  return (
    <>
      <TableRow
        className={cn('cursor-pointer', isExpanded && 'border-b-0')}
        onClick={() => {
          if (hasTools) onToggleExpand()
        }}
      >
        <TableCell className="w-8 px-2">
          {hasTools ? (
            isExpanded ? (
              <ChevronDown className="text-muted-foreground h-4 w-4" />
            ) : (
              <ChevronRight className="text-muted-foreground h-4 w-4" />
            )
          ) : null}
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
        <TableCell className="font-mono text-sm">{server.url}</TableCell>
        <TableCell>
          {isDisabled ? (
            <Badge variant="secondary">Disabled</Badge>
          ) : isProbing ? (
            <Badge variant="outline" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Checking
            </Badge>
          ) : isOnline ? (
            <Badge className="border-green-500/20 bg-green-500/15 text-green-600 dark:text-green-400">
              Online
            </Badge>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="destructive" className="gap-1">
                    <CircleAlert className="h-3 w-3" />
                    Offline
                  </Badge>
                </TooltipTrigger>
                {probe?.error && (
                  <TooltipContent>
                    <p className="max-w-xs text-xs">{probe.error}</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )}
        </TableCell>
        <TableCell>
          {isDisabled ? (
            <span className="text-muted-foreground text-sm">—</span>
          ) : isProbing ? (
            <span className="text-muted-foreground text-sm">…</span>
          ) : (
            <Badge variant="outline" className="gap-1">
              <Wrench className="h-3 w-3" />
              {tools.length}
            </Badge>
          )}
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={!server.disabled}
            onCheckedChange={onToggleDisabled}
            className="data-[state=checked]:bg-green-500"
          />
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Edit className="h-4 w-4" />
            </Button>
            <Button variant="destructive" size="sm" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {isExpanded && hasTools && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={7} className="bg-muted/30 px-6 py-3">
            <div className="space-y-2">
              <h4 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                Available Tools ({tools.length})
              </h4>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                {tools.map((tool) => {
                  const summary = tool.description
                    ? getFirstSentence(tool.description)
                    : undefined
                  return (
                    <TooltipProvider key={tool.name}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="bg-background hover:border-primary/30 group min-w-0 overflow-hidden rounded-md border px-3 py-2 transition-colors">
                            <div className="flex items-center gap-2">
                              <div className="bg-primary/10 flex h-5 w-5 shrink-0 items-center justify-center rounded">
                                <Wrench className="text-primary h-3 w-3" />
                              </div>
                              <span className="truncate text-sm font-medium">
                                {tool.name}
                              </span>
                            </div>
                            {summary && (
                              <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed">
                                {summary}
                              </p>
                            )}
                          </div>
                        </TooltipTrigger>
                        {tool.description && (
                          <TooltipContent
                            side="bottom"
                            className="max-w-xs text-xs"
                          >
                            <p className="font-medium">{tool.name}</p>
                            <p className="text-muted-foreground mt-1 whitespace-pre-line">
                              {tool.description}
                            </p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  )
                })}
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

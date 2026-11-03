// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader, Plus, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { EmptyState } from '@/components/common/empty-state'
import { InlineNotice } from '@/components/common/inline-notice'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getErrorMessage } from '@/lib/errors'
import type { McpServer } from '@/payload-types'
import type { Service } from '@/services/types'
import { AddServerDialog } from './components/add-server-dialog'
import { ConnectionOutcome } from './components/connection-outcome'
import { ServerCard } from './components/server-card'
import { ServerRow } from './components/server-row'
import { ServerTable, ServerTableSkeleton } from './components/server-table'
import { type McpProbeResult, useMcpServers, useMcpServersProbe } from './hooks'
import { useMcpServerActions } from './hooks/use-mcp-server-actions'

type DialogTarget = { mode: 'add' } | { mode: 'edit'; server: McpServer }

/** The just-saved server's connection outcome, checked once the list reloads. */
function SavedNotice({
  server,
  probe,
  onDismiss,
}: {
  server: McpServer
  probe: McpProbeResult | undefined
  onDismiss: () => void
}) {
  const dismiss = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Dismiss"
      className="shrink-0"
      onClick={onDismiss}
    >
      <X aria-hidden="true" className="h-3.5 w-3.5" />
    </Button>
  )
  return (
    <div
      className="bg-muted/30 flex items-start gap-2 rounded-md border p-3"
      data-testid="mcp-saved-notice"
    >
      <div className="min-w-0 flex-1 space-y-1.5 text-xs">
        <p className="text-foreground font-medium">Saved “{server.name}”.</p>
        {server.disabled ? (
          <p className="text-muted-foreground">
            It is disabled, so it is not connected to and chats do not offer its
            tools.
          </p>
        ) : probe ? (
          <ConnectionOutcome result={probe} />
        ) : (
          <p
            role="status"
            className="text-muted-foreground flex items-center gap-1.5"
          >
            <Loader aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            Checking the connection…
          </p>
        )}
      </div>
      {dismiss}
    </div>
  )
}

export function McpDemo(_props: { service: Service }) {
  const [dialog, setDialog] = useState<DialogTarget | null>(null)
  const [serverToDelete, setServerToDelete] = useState<McpServer | null>(null)
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<number>>(new Set())
  /** The server saved last (as saved), while its outcome is shown. */
  const [saved, setSaved] = useState<Pick<
    McpServer,
    'id' | 'updatedAt'
  > | null>(null)

  const serversQuery = useMcpServers()
  const servers = serversQuery.data ?? []
  const probes = useMcpServersProbe(servers)
  const actions = useMcpServerActions()
  const savedServer = servers.find((s) => s.id === saved?.id)
  // Until the list shows the saved version, its probe is of the old one. A
  // later version (the Enabled switch, another tab) is probed in its turn.
  const savedProbe =
    savedServer &&
    saved &&
    Date.parse(savedServer.updatedAt) >= Date.parse(saved.updatedAt)
      ? probes[savedServer.id]
      : undefined

  const toggleExpanded = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openAdd = () => setDialog({ mode: 'add' })
  const editingServer = dialog?.mode === 'edit' ? dialog.server : undefined

  const rowProps = (server: McpServer) => ({
    server,
    probe: probes[server.id],
    isExpanded: expandedIds.has(server.id),
    onToggleExpand: () => toggleExpanded(server.id),
    onToggleDisabled: () => actions.toggleDisabled(server),
    onEdit: () => setDialog({ mode: 'edit', server }),
    onDelete: () => setServerToDelete(server),
  })

  const list = (() => {
    if (serversQuery.isLoading) return <ServerTableSkeleton />
    if (serversQuery.isError) {
      return (
        <InlineNotice tone="destructive" size="sm">
          Could not load the MCP servers:{' '}
          {getErrorMessage(serversQuery.error, 'the request failed')}.{' '}
          <Button
            variant="link"
            size="xs"
            className="h-auto p-0"
            onClick={() => void serversQuery.refetch()}
            disabled={serversQuery.isFetching}
          >
            <RefreshCw aria-hidden="true" />
            Retry
          </Button>
        </InlineNotice>
      )
    }
    if (servers.length === 0) {
      return (
        <EmptyState
          icon={Plus}
          title="No MCP servers"
          description="Add an MCP server so chats can call its tools."
          className="py-8"
        >
          <Button className="mt-4" onClick={openAdd}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add Your First Server
          </Button>
        </EmptyState>
      )
    }
    return (
      <>
        <div className="hidden md:block">
          <ServerTable>
            {servers.map((server) => (
              <ServerRow key={server.id} {...rowProps(server)} />
            ))}
          </ServerTable>
        </div>
        <ul
          className="space-y-3 md:hidden"
          aria-label="MCP servers"
          data-testid="mcp-server-cards"
        >
          {servers.map((server) => (
            <ServerCard key={server.id} {...rowProps(server)} />
          ))}
        </ul>
      </>
    )
  })()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">MCP Servers</h3>
            <div className="text-muted-foreground text-sm font-normal">
              Manage your Model Context Protocol servers and their
              configurations.
            </div>
          </div>

          <Button onClick={openAdd} className="flex items-center gap-2">
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add Server
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {savedServer && (
          <SavedNotice
            server={savedServer}
            probe={savedProbe}
            onDismiss={() => setSaved(null)}
          />
        )}

        {list}

        <AddServerDialog
          open={dialog !== null}
          onOpenChange={(open) => {
            if (!open) setDialog(null)
          }}
          onSave={async (data) => {
            const record = editingServer
              ? await actions.update(editingServer.id, data)
              : await actions.add(data)
            setSaved({ id: record.id, updatedAt: record.updatedAt })
          }}
          editingServer={editingServer}
        />

        <ConfirmDialog
          open={serverToDelete !== null}
          onOpenChange={(open) => {
            if (!open) setServerToDelete(null)
          }}
          variant="destructive"
          title={`Delete ${serverToDelete?.name ?? 'this server'}?`}
          description="The server is removed from the MCP Manager, and chats stop offering its tools. This cannot be undone."
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          onConfirm={async () => {
            if (!serverToDelete) return
            await actions.remove(serverToDelete)
            if (serverToDelete.id === saved?.id) setSaved(null)
          }}
          confirmTestId="mcp-delete-confirm"
        />
      </CardContent>
    </Card>
  )
}

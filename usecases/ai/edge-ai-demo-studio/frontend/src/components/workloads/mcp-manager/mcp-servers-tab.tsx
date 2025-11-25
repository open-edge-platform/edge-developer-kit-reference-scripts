// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../ui/table'
import { Switch } from '@/components/ui/switch'
import { Plus, Trash2, Edit, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { McpServer } from '@/payload-types'
import AddServerDialog from './add-server-dialog'

export default function McpServersTab() {
  const [servers, setServers] = useState<McpServer[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingServer, setEditingServer] = useState<McpServer | undefined>()

  // Load servers from PayloadCMS
  useEffect(() => {
    const loadServers = async () => {
      try {
        const response = await fetch('/api/mcp-servers')
        if (response.ok) {
          const data = await response.json()
          setServers(data.docs || [])
        } else {
          console.error('Failed to load MCP servers:', response.statusText)
        }
      } catch (error) {
        console.error('Error loading MCP servers:', error)
        toast.error('Failed to load MCP servers')
      } finally {
        setLoading(false)
      }
    }

    loadServers()
  }, [])

  const handleAddServer = async (
    serverData: Omit<McpServer, 'id' | 'updatedAt' | 'createdAt'>,
  ) => {
    try {
      const response = await fetch('/api/mcp-servers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(serverData),
      })

      if (response.ok) {
        const newServer = await response.json()
        setServers((prev) => [...prev, newServer.doc])
        toast.success('MCP server added successfully')
      } else {
        throw new Error('Failed to add server')
      }
    } catch (error) {
      console.error('Error adding MCP server:', error)
      toast.error('Failed to add MCP server')
    }
  }

  const handleEditServer = async (
    serverData: Omit<McpServer, 'id' | 'updatedAt' | 'createdAt'>,
  ) => {
    if (!editingServer) return

    try {
      const response = await fetch(`/api/mcp-servers/${editingServer.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(serverData),
      })

      if (response.ok) {
        const updatedServer = await response.json()
        setServers((prev) =>
          prev.map((server) =>
            server.id === editingServer.id ? updatedServer.doc : server,
          ),
        )
        toast.success('MCP server updated successfully')
        setEditingServer(undefined)
      } else {
        throw new Error('Failed to update server')
      }
    } catch (error) {
      console.error('Error updating MCP server:', error)
      toast.error('Failed to update MCP server')
    }
  }

  const handleDeleteServer = async (serverId: number) => {
    try {
      const sanitizedURL = new URL(
        `/api/mcp-servers/${serverId}`,
        window.location.origin,
      )
      const response = await fetch(sanitizedURL, {
        method: 'DELETE',
      })

      if (response.ok) {
        setServers((prev) => prev.filter((server) => server.id !== serverId))
        toast.success('MCP server deleted successfully')
      } else {
        throw new Error('Failed to delete server')
      }
    } catch (error) {
      console.error('Error deleting MCP server:', error)
      toast.error('Failed to delete MCP server')
    }
  }

  const handleToggleDisabled = async (server: McpServer) => {
    try {
      const response = await fetch(`/api/mcp-servers/${server.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ disabled: !server.disabled }),
      })

      if (response.ok) {
        const updatedServer = await response.json()
        setServers((prev) =>
          prev.map((s) => (s.id === server.id ? updatedServer.doc : s)),
        )
        toast.success(`MCP server ${server.disabled ? 'enabled' : 'disabled'}`)
      } else {
        throw new Error('Failed to toggle server status')
      }
    } catch (error) {
      console.error('Error toggling MCP server status:', error)
      toast.error('Failed to toggle server status')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold">MCP Servers</h3>
            <div className="text-muted-foreground text-sm font-normal">
              Manage your Model Context Protocol servers and their status.
            </div>
          </div>

          <Button
            onClick={() => setShowAddDialog(true)}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Server
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center">
            <div className="text-center">
              <Loader2 className="m-auto h-8 w-8 animate-spin" />
            </div>
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
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Your First Server
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {servers.map((server) => (
                  <TableRow key={server.id}>
                    <TableCell className="font-medium">{server.name}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {server.url}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={!server.disabled}
                          onCheckedChange={() => handleToggleDisabled(server)}
                          className="data-[state=checked]:bg-green-500"
                        />
                        <span className="text-sm">
                          {!server.disabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingServer(server)
                            setShowAddDialog(true)
                          }}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteServer(server.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
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

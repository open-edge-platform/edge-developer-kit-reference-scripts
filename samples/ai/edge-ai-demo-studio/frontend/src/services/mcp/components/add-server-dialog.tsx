// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { McpServer } from '@/payload-types'
import { toast } from 'sonner'

interface AddServerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (server: Omit<McpServer, 'id' | 'updatedAt' | 'createdAt'>) => void
  editingServer?: McpServer
}

export function AddServerDialog({
  open,
  onOpenChange,
  onSave,
  editingServer,
}: AddServerDialogProps) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [disabled, setDisabled] = useState(false)

  const [prevDeps, setPrevDeps] = useState({
    editingServer,
    open,
  })

  if (editingServer !== prevDeps.editingServer || open !== prevDeps.open) {
    setPrevDeps({ editingServer, open })
    if (editingServer) {
      setName(editingServer.name)
      setUrl(editingServer.url)
      setApiKey(editingServer.apiKey ?? '')
      setDisabled(editingServer.disabled ?? false)
    } else {
      setName('')
      setUrl('')
      setApiKey('')
      setDisabled(false)
    }
  }

  const handleSave = () => {
    if (!name.trim() || !url.trim()) {
      toast.error('Name and URL are required')
      return
    }

    onSave({
      name: name.trim(),
      url: url.trim(),
      apiKey: apiKey.trim() || undefined,
      disabled,
    })

    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {editingServer ? 'Edit MCP Server' : 'Add MCP Server'}
          </DialogTitle>
          <DialogDescription>
            {editingServer
              ? 'Update the MCP server configuration.'
              : 'Add a new MCP server to integrate external tools and capabilities.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="mcp-name" className="text-right">
              Name
            </Label>
            <Input
              id="mcp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="col-span-3"
              placeholder="My MCP Server"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="mcp-url" className="text-right">
              URL
            </Label>
            <Input
              id="mcp-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="col-span-3"
              placeholder="http://localhost:8000/mcp"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="mcp-api-key" className="text-right">
              API Key
            </Label>
            <Input
              id="mcp-api-key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="col-span-3"
              placeholder="Optional API key"
              type="password"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="mcp-enabled" className="text-right">
              Enabled
            </Label>
            <Switch
              id="mcp-enabled"
              checked={!disabled}
              onCheckedChange={(checked) => setDisabled(!checked)}
              className="col-span-3"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave}>
            {editingServer ? 'Update' : 'Add'} Server
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

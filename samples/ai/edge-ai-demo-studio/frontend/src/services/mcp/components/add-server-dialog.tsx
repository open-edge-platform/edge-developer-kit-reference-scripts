// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader, PlugZap } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'
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
import { getErrorMessage } from '@/lib/errors'
import type { McpServer } from '@/payload-types'
import {
  type McpProbeTarget,
  type McpServerInput,
  useTestMcpConnection,
} from '../hooks'
import { ConnectionOutcome } from './connection-outcome'

interface AddServerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The dialog stays open, keeping its input and showing any error, until this resolves. */
  onSave: (server: McpServerInput) => Promise<unknown>
  editingServer?: McpServer
}

export function AddServerDialog({
  open,
  onOpenChange,
  onSave,
  editingServer,
}: AddServerDialogProps) {
  const [saving, setSaving] = useState(false)

  // Escape, an outside click and the X wait for a running save: its error
  // is shown in the form, which closing would take away.
  const handleOpenChange = (next: boolean) => {
    if (saving) return
    onOpenChange(next)
  }

  const save = async (server: McpServerInput) => {
    setSaving(true)
    try {
      await onSave(server)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editingServer ? 'Edit MCP Server' : 'Add MCP Server'}
          </DialogTitle>
          <DialogDescription>
            {editingServer
              ? 'Update the MCP server configuration.'
              : 'Add an MCP server whose tools chats can call. Test the connection to see its tools before saving.'}
          </DialogDescription>
        </DialogHeader>
        {/* Keyed so another server (or a new one) starts from clean state. */}
        <ServerForm
          key={editingServer?.id ?? 'new'}
          editingServer={editingServer}
          onSave={save}
          saving={saving}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  )
}

interface ServerFormProps {
  editingServer?: McpServer
  onSave: (server: McpServerInput) => Promise<unknown>
  /** `onSave` has not settled yet. */
  saving: boolean
  onOpenChange: (open: boolean) => void
}

function ServerForm({
  editingServer,
  onSave,
  saving,
  onOpenChange,
}: ServerFormProps) {
  const [name, setName] = useState(editingServer?.name ?? '')
  const [url, setUrl] = useState(editingServer?.url ?? '')
  // The stored key is never read back: the field holds a new key only.
  const [apiKey, setApiKey] = useState('')
  const [removeKey, setRemoveKey] = useState(false)
  const [disabled, setDisabled] = useState(editingServer?.disabled ?? false)
  const [error, setError] = useState<string | null>(null)

  const hasStoredKey = Boolean(editingServer?.hasApiKey) && !removeKey
  const newKey = apiKey.trim()
  const trimmedUrl = url.trim()
  const urlUnchanged = trimmedUrl === editingServer?.url

  const {
    mutate: runTest,
    data: testResult,
    error: testError,
    isPending: testing,
    variables: testedTarget,
  } = useTestMcpConnection()
  // A saved server with its stored key is probed by id: the key never
  // comes back to the browser. Anything typed is probed as typed.
  const testTarget: McpProbeTarget | null = !trimmedUrl
    ? null
    : editingServer && urlUnchanged && !newKey && !removeKey
      ? { id: editingServer.id }
      : { url: trimmedUrl, apiKey: newKey || undefined }
  const testIsCurrent =
    testedTarget !== undefined &&
    JSON.stringify(testedTarget) === JSON.stringify(testTarget)
  // A changed address is probed without the stored key, which stays on the
  // server; say so, the server may refuse the test for it.
  const testedWithoutStoredKey =
    hasStoredKey && !newKey && !urlUnchanged && trimmedUrl !== ''

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !url.trim()) {
      setError('Name and URL are required')
      return
    }
    setError(null)
    try {
      await onSave({
        name: name.trim(),
        url: url.trim(),
        // A blank field keeps the stored key (JSON drops `undefined`);
        // `null` removes it.
        apiKey: newKey || (removeKey ? null : undefined),
        disabled,
      })
      onOpenChange(false)
    } catch (err) {
      setError(getErrorMessage(err, 'The server could not be saved'))
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
      <div className="grid gap-4 py-4">
        <div className="grid gap-2 sm:grid-cols-4 sm:items-center sm:gap-4">
          <Label htmlFor="mcp-name" className="sm:justify-end">
            Name
          </Label>
          <Input
            id="mcp-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="sm:col-span-3"
            placeholder="My MCP Server"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-4 sm:items-center sm:gap-4">
          <Label htmlFor="mcp-url" className="sm:justify-end">
            URL
          </Label>
          <Input
            id="mcp-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="sm:col-span-3"
            placeholder="http://127.0.0.1:8000/mcp"
            inputMode="url"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-4 sm:items-center sm:gap-4">
          <Label htmlFor="mcp-api-key" className="sm:justify-end">
            API Key
          </Label>
          <div className="space-y-1 sm:col-span-3">
            <Input
              id="mcp-api-key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                hasStoredKey
                  ? 'Stored — leave blank to keep'
                  : removeKey
                    ? 'The stored key will be removed'
                    : 'Optional API key'
              }
              type="password"
              autoComplete="off"
            />
            {editingServer?.hasApiKey && (
              <Button
                type="button"
                variant="link"
                size="xs"
                className="h-auto p-0"
                onClick={() => {
                  setRemoveKey(!removeKey)
                  setApiKey('')
                }}
              >
                {removeKey ? 'Keep the stored key' : 'Remove key'}
              </Button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 sm:grid sm:grid-cols-4">
          <Label htmlFor="mcp-enabled" className="sm:justify-end">
            Enabled
          </Label>
          <Switch
            id="mcp-enabled"
            checked={!disabled}
            onCheckedChange={(checked) => setDisabled(!checked)}
            className="sm:col-span-3"
          />
        </div>

        <div
          className="bg-muted/30 space-y-2 rounded-md border p-3"
          data-testid="mcp-connection-test"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">
              Connect to the server and list its tools, without saving.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!testTarget || testing}
              onClick={() => {
                if (testTarget) runTest(testTarget)
              }}
            >
              {testing ? (
                <Loader aria-hidden="true" className="animate-spin" />
              ) : (
                <PlugZap aria-hidden="true" />
              )}
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
          </div>
          {testedWithoutStoredKey && (
            <p className="text-muted-foreground text-xs">
              The stored API key is only sent to the saved address: enter the
              key again to test the new one with it.
            </p>
          )}
          {!testing && testIsCurrent && testResult && (
            <ConnectionOutcome
              result={testResult}
              data-testid="mcp-connection-test-outcome"
            />
          )}
          {!testing && testIsCurrent && testError && (
            <InlineNotice tone="destructive" size="sm" role="status">
              {getErrorMessage(testError, 'The address was refused')}
            </InlineNotice>
          )}
          {!testing && testedTarget !== undefined && !testIsCurrent && (
            <p className="text-muted-foreground text-xs">
              The address or key changed since the last test.
            </p>
          )}
        </div>
        {error && (
          <InlineNotice tone="destructive" size="sm">
            {error}
          </InlineNotice>
        )}
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader aria-hidden="true" className="animate-spin" />}
          {editingServer ? 'Update' : 'Add'} Server
        </Button>
      </DialogFooter>
    </form>
  )
}

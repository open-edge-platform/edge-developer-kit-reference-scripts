// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { List, Loader, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { EmptyState } from '@/components/common/empty-state'
import { InlineNotice } from '@/components/common/inline-notice'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getErrorMessage } from '@/lib/errors'
import type { Chunk } from '../types'

interface ChunksPanelProps {
  chunks: Chunk[]
  totalChunks: number
  isLoading: boolean
  isFetching: boolean
  loadError?: Error | null
  canMutate: boolean
  isUpdating: boolean
  onRefresh: () => void
  /** Deletes a chunk, once confirmed; rejects with the reason. */
  onDeleteChunk: (docId: string) => Promise<unknown>
  /** Replaces a chunk's text; the editor stays open until this resolves. */
  onReplaceChunk: (docId: string, content: string) => Promise<unknown>
}

/** "Existing Chunks" panel: lists stored chunks with inline edit / delete. */
export function ChunksPanel({
  chunks,
  totalChunks,
  isLoading,
  isFetching,
  loadError,
  canMutate,
  isUpdating,
  onRefresh,
  onDeleteChunk,
  onReplaceChunk,
}: ChunksPanelProps) {
  const [editingDocId, setEditingDocId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [chunkToDelete, setChunkToDelete] = useState<Chunk | null>(null)
  // Set on click: the mutation's pending state reaches React a tick later.
  const [saving, setSaving] = useState(false)
  const busy = saving || isUpdating

  const startEdit = (chunk: Chunk) => {
    setEditingDocId(chunk.doc_id)
    setEditingContent(chunk.content)
  }

  const cancelEdit = () => {
    setEditingDocId(null)
    setEditingContent('')
  }

  const submitReplace = async () => {
    const content = editingContent.trim()
    if (!editingDocId || !content || busy) return
    setSaving(true)
    try {
      await onReplaceChunk(editingDocId, content)
      cancelEdit()
    } catch {
      // The caller shows why; the edit stays open with its text.
    } finally {
      setSaving(false)
    }
  }

  const body = (() => {
    if (isLoading) {
      return (
        <p className="text-muted-foreground py-4 text-center text-xs">
          Loading chunks…
        </p>
      )
    }
    if (loadError && chunks.length === 0) {
      return (
        <InlineNotice tone="destructive" size="sm">
          Could not load the chunks:{' '}
          {getErrorMessage(loadError, 'the worker did not answer')}.
        </InlineNotice>
      )
    }
    if (chunks.length === 0) {
      return (
        <EmptyState
          icon={List}
          description="No chunks yet for this knowledge base."
          className="border px-4 py-6"
        />
      )
    }
    return (
      <ul className="space-y-2">
        {chunks.map((chunk) => {
          const isEditing = editingDocId === chunk.doc_id
          const source = String(chunk.metadata?.source ?? 'manual_chunk')
          return (
            <li
              key={chunk.doc_id}
              data-testid="vectordb-chunk"
              className="border-border bg-muted/20 space-y-2 rounded-lg border p-3"
            >
              {isEditing ? (
                <>
                  <Label
                    htmlFor={`chunk-edit-${chunk.doc_id}`}
                    className="sr-only"
                  >
                    Chunk text
                  </Label>
                  <Textarea
                    id={`chunk-edit-${chunk.doc_id}`}
                    value={editingContent}
                    onChange={(e) => setEditingContent(e.target.value)}
                    rows={4}
                    className="bg-background/70 resize-none text-xs"
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={() => void submitReplace()}
                      size="sm"
                      disabled={!editingContent.trim() || busy || !canMutate}
                      className="h-7 flex-1 text-xs"
                    >
                      {busy ? (
                        <Loader
                          aria-label="Saving"
                          className="h-3 w-3 animate-spin"
                        />
                      ) : (
                        'Save'
                      )}
                    </Button>
                    <Button
                      onClick={cancelEdit}
                      size="sm"
                      variant="outline"
                      className="h-7 flex-1 text-xs"
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-foreground line-clamp-3 text-sm">
                    {chunk.content}
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <Badge
                      variant="secondary"
                      className="max-w-[65%] truncate text-xs"
                    >
                      {source}
                    </Badge>
                    <div className="flex gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => startEdit(chunk)}
                        disabled={busy || !canMutate}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label={`Delete chunk #${chunk.chunk_id}`}
                        onClick={() => setChunkToDelete(chunk)}
                        disabled={busy}
                      >
                        <Trash2
                          aria-hidden="true"
                          className="text-destructive h-3.5 w-3.5"
                        />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ul>
    )
  })()

  return (
    <Card className="gap-3.5 py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2.5 text-sm">
          <List aria-hidden="true" className="text-primary h-4 w-4" />
          Existing Chunks ({totalChunks})
        </CardTitle>
        <CardAction>
          <Button
            onClick={onRefresh}
            variant="outline"
            size="sm"
            className="h-8 px-3 text-xs"
            disabled={isFetching}
          >
            {isFetching && (
              <Loader aria-hidden="true" className="h-3 w-3 animate-spin" />
            )}
            Refresh
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="max-h-[320px] space-y-2 overflow-auto px-5">
        {body}
      </CardContent>

      <ConfirmDialog
        open={chunkToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setChunkToDelete(null)
        }}
        variant="destructive"
        title="Delete this chunk?"
        description="It is removed from the vector store, so searches no longer find it. This can’t be undone."
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        onConfirm={async () => {
          if (chunkToDelete) await onDeleteChunk(chunkToDelete.doc_id)
        }}
      />
    </Card>
  )
}

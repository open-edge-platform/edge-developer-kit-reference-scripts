// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { List, Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { Chunk } from '../types'
import { PanelCard } from './panel-card'

interface ChunksPanelProps {
  chunks: Chunk[]
  totalChunks: number
  isLoading: boolean
  isFetching: boolean
  canMutate: boolean
  isAdding: boolean
  isDeleting: boolean
  onRefresh: () => void
  onDeleteChunk: (docId: string) => void
  onReplaceChunk: (docId: string, content: string) => void
}

/** "Existing Chunks" panel: lists stored chunks with inline edit / delete. */
export function ChunksPanel({
  chunks,
  totalChunks,
  isLoading,
  isFetching,
  canMutate,
  isAdding,
  isDeleting,
  onRefresh,
  onDeleteChunk,
  onReplaceChunk,
}: ChunksPanelProps) {
  const [editingDocId, setEditingDocId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')

  const isUpdating = isAdding || isDeleting

  const startEdit = (chunk: Chunk) => {
    setEditingDocId(chunk.doc_id)
    setEditingContent(chunk.content)
  }

  const cancelEdit = () => {
    setEditingDocId(null)
    setEditingContent('')
  }

  const submitReplace = () => {
    const content = editingContent.trim()
    if (!editingDocId || !content) return
    onReplaceChunk(editingDocId, content)
    cancelEdit()
  }

  const refreshAction = (
    <Button
      onClick={onRefresh}
      variant="outline"
      size="sm"
      className="h-8 px-3 text-xs"
      disabled={isFetching}
    >
      {isFetching ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
      Refresh
    </Button>
  )

  return (
    <PanelCard
      icon={List}
      title={`Existing Chunks (${totalChunks})`}
      action={refreshAction}
    >
      <div className="max-h-[320px] space-y-2 overflow-auto">
        {isLoading ? (
          <div className="text-muted-foreground py-4 text-center text-xs">
            Loading chunks…
          </div>
        ) : chunks.length === 0 ? (
          <div className="text-muted-foreground border-border rounded-lg border border-dashed p-6 text-center text-xs">
            No chunks yet for this knowledge base.
          </div>
        ) : (
          chunks.map((chunk) => {
            const isEditing = editingDocId === chunk.doc_id
            return (
              <div
                key={chunk.doc_id}
                className="border-border bg-muted/20 space-y-2 rounded-lg border p-3"
              >
                {isEditing ? (
                  <>
                    <Textarea
                      value={editingContent}
                      onChange={(e) => setEditingContent(e.target.value)}
                      rows={4}
                      className="bg-background/70 resize-none text-xs"
                    />
                    <div className="flex gap-2">
                      <Button
                        onClick={submitReplace}
                        size="sm"
                        disabled={
                          !editingContent.trim() || isUpdating || !canMutate
                        }
                        className="h-7 flex-1 text-xs"
                      >
                        {isUpdating ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
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
                        className="max-w-[65%] truncate text-[10px]"
                      >
                        {String(chunk.metadata?.source ?? 'manual_chunk')}
                      </Badge>
                      <div className="flex gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => startEdit(chunk)}
                          disabled={isUpdating || !canMutate}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => onDeleteChunk(chunk.doc_id)}
                          disabled={isDeleting}
                        >
                          <Trash2 className="text-destructive h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )
          })
        )}
      </div>
    </PanelCard>
  )
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlignLeft, Loader2, Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { PanelCard } from './panel-card'

interface AddChunkPanelProps {
  canMutate: boolean
  isAdding: boolean
  onAddChunk: (content: string) => void
}

/** "Add Text Chunk" panel: enter free text to store directly in the KB. */
export function AddChunkPanel({
  canMutate,
  isAdding,
  onAddChunk,
}: AddChunkPanelProps) {
  const [content, setContent] = useState('')

  const submit = () => {
    const trimmed = content.trim()
    if (!trimmed) return
    onAddChunk(trimmed)
    setContent('')
  }

  return (
    <PanelCard
      icon={AlignLeft}
      title="Add Text Chunk"
      bodyClassName="space-y-3"
    >
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Enter text content to store..."
        rows={4}
        className="bg-muted/30 resize-y text-sm"
      />
      <Button
        onClick={submit}
        disabled={isAdding || !content.trim() || !canMutate}
        variant="outline"
        className="border-primary text-primary hover:bg-primary/5 w-full gap-2"
      >
        {isAdding ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        Add Chunk
      </Button>
    </PanelCard>
  )
}

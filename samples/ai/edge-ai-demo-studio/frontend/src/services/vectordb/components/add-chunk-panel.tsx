// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlignLeft, Loader, Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface AddChunkPanelProps {
  canMutate: boolean
  isAdding: boolean
  /** Stores the text; the field keeps it until this resolves. */
  onAddChunk: (content: string) => Promise<unknown>
}

/** "Add Text Chunk" panel: enter free text to store directly in the KB. */
export function AddChunkPanel({
  canMutate,
  isAdding,
  onAddChunk,
}: AddChunkPanelProps) {
  const [content, setContent] = useState('')
  // Set on click: the mutation's pending state reaches React a tick later.
  const [submitting, setSubmitting] = useState(false)
  const busy = submitting || isAdding

  const submit = async () => {
    const trimmed = content.trim()
    if (!trimmed || busy) return
    setSubmitting(true)
    try {
      await onAddChunk(trimmed)
      setContent('')
    } catch {
      // The caller shows why; the text stays for another try.
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="gap-3.5 py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2.5 text-sm">
          <AlignLeft aria-hidden="true" className="text-primary h-4 w-4" />
          Add Text Chunk
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-5">
        <Label htmlFor="vectordb-chunk-text" className="sr-only">
          Text to store
        </Label>
        <Textarea
          id="vectordb-chunk-text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Enter text content to store..."
          rows={4}
          className="bg-muted/30 resize-y text-sm"
        />
        <Button
          onClick={() => void submit()}
          disabled={busy || !content.trim() || !canMutate}
          variant="outline"
          className="border-primary text-primary hover:bg-primary/5 w-full gap-2"
        >
          {busy ? (
            <Loader aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : (
            <Plus aria-hidden="true" className="h-4 w-4" />
          )}
          Add Chunk
        </Button>
      </CardContent>
    </Card>
  )
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Database, Loader, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
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
import { Input } from '@/components/ui/input'
import { plural } from '@/lib/browser/format'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import type { KnowledgeBase } from '../types'

interface KnowledgeBasesRailProps {
  knowledgeBases: KnowledgeBase[]
  selectedKb: KnowledgeBase | null
  kbName: string
  onKbNameChange: (value: string) => void
  onCreate: () => void
  isCreating: boolean
  onRefresh: () => void
  isFetching: boolean
  isLoading: boolean
  loadError?: Error | null
  onSelect: (kb: KnowledgeBase) => void
  /** Deletes a knowledge base, once confirmed; rejects with the reason. */
  onDelete: (id: number) => Promise<void>
}

/** Knowledge bases with create, refresh and delete; selecting one drives the workspace. */
export function KnowledgeBasesRail({
  knowledgeBases,
  selectedKb,
  kbName,
  onKbNameChange,
  onCreate,
  isCreating,
  onRefresh,
  isFetching,
  isLoading,
  loadError,
  onSelect,
  onDelete,
}: KnowledgeBasesRailProps) {
  const [kbToDelete, setKbToDelete] = useState<KnowledgeBase | null>(null)

  const listBody = (() => {
    if (loadError && knowledgeBases.length === 0) {
      return (
        <InlineNotice tone="destructive" size="sm">
          Could not load the knowledge bases:{' '}
          {getErrorMessage(loadError, 'the worker did not answer')}.
        </InlineNotice>
      )
    }
    if (knowledgeBases.length === 0) {
      return (
        <p className="text-muted-foreground py-6 text-center text-xs">
          {isLoading
            ? 'Loading knowledge bases…'
            : 'No knowledge bases yet. Create one above.'}
        </p>
      )
    }
    return (
      <ul className="space-y-1.5">
        {knowledgeBases.map((kb) => {
          const selected = selectedKb?.id === kb.id
          return (
            <li
              key={kb.id}
              className={cn(
                'flex items-center gap-1 rounded-lg border pr-1.5 text-sm transition-colors',
                selected
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-muted/40',
              )}
            >
              <div
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                onClick={() => onSelect(kb)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(kb)
                  }
                }}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg p-2.5 text-left"
              >
                <Database
                  aria-hidden="true"
                  className={cn(
                    'h-4 w-4 shrink-0',
                    selected ? 'text-primary' : 'text-muted-foreground',
                  )}
                />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate',
                    selected ? 'font-semibold' : 'font-medium',
                  )}
                  title={kb.name}
                >
                  {kb.name}
                </span>
                {selected ? (
                  <Badge tone="primary" className="text-xs font-bold">
                    Active
                  </Badge>
                ) : (
                  <span className="text-muted-foreground text-xs tabular-nums">
                    ID {kb.id}
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive shrink-0"
                aria-label={`Delete knowledge base ${kb.name}`}
                onClick={() => setKbToDelete(kb)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          )
        })}
      </ul>
    )
  })()

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="px-5 pt-5 pb-3.5">
        <CardTitle className="flex items-center gap-2.5 text-sm">
          <Database aria-hidden="true" className="text-primary h-4 w-4" />
          Knowledge bases
        </CardTitle>
        <CardAction>
          <Button
            onClick={onRefresh}
            disabled={isFetching}
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="Refresh list"
            title="Refresh list"
          >
            <RefreshCw
              aria-hidden="true"
              className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')}
            />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="border-border border-t p-4">
        <div className="flex gap-2">
          <Input
            value={kbName}
            onChange={(e) => onKbNameChange(e.target.value)}
            placeholder="New knowledge base name..."
            aria-label="New knowledge base name"
            className="bg-muted/30 text-sm"
            onKeyDown={(e) => e.key === 'Enter' && onCreate()}
          />
          <Button
            onClick={onCreate}
            disabled={isCreating || !kbName.trim()}
            size="icon"
            className="shrink-0"
            aria-label="Create knowledge base"
            title="Create knowledge base"
          >
            {isCreating ? (
              <Loader aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Plus aria-hidden="true" className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardContent>

      <CardContent className="border-border max-h-[480px] space-y-1.5 overflow-y-auto border-t p-3">
        <p className="text-muted-foreground px-2 pb-1 text-xs font-semibold tracking-wide uppercase">
          {plural(knowledgeBases.length, 'base')}
        </p>
        {listBody}
      </CardContent>

      <ConfirmDialog
        open={kbToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setKbToDelete(null)
        }}
        variant="destructive"
        title={`Delete “${kbToDelete?.name ?? ''}”?`}
        description="The knowledge base, its documents and every chunk embedded from them are deleted. This can’t be undone."
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        onConfirm={async () => {
          if (kbToDelete) await onDelete(kbToDelete.id)
        }}
      />
    </Card>
  )
}

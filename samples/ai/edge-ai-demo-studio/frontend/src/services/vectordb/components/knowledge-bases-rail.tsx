// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Database, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { KnowledgeBase } from '../types'
import { PanelCard } from './panel-card'

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
  onSelect: (kb: KnowledgeBase) => void
  onDelete: (id: number) => void
}

/**
 * Left rail listing knowledge bases with inline create, refresh and delete.
 * Selecting a row drives the workspace on the right.
 */
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
  onSelect,
  onDelete,
}: KnowledgeBasesRailProps) {
  const countLabel = `${knowledgeBases.length} ${
    knowledgeBases.length === 1 ? 'base' : 'bases'
  }`

  const refreshAction = (
    <Button
      onClick={onRefresh}
      disabled={isFetching}
      variant="outline"
      size="icon"
      className="h-8 w-8"
      title="Refresh list"
    >
      <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
    </Button>
  )

  return (
    <PanelCard
      icon={Database}
      title="Knowledge Bases"
      action={refreshAction}
      bodyClassName="p-0"
    >
      <div className="border-border border-t p-4">
        <div className="flex gap-2">
          <Input
            value={kbName}
            onChange={(e) => onKbNameChange(e.target.value)}
            placeholder="New knowledge base name..."
            className="bg-muted/30 text-sm"
            onKeyDown={(e) => e.key === 'Enter' && onCreate()}
          />
          <Button
            onClick={onCreate}
            disabled={isCreating || !kbName.trim()}
            size="icon"
            className="bg-primary hover:bg-primary-light shrink-0 text-white"
            title="Create knowledge base"
          >
            {isCreating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      <div className="border-border max-h-[480px] space-y-1.5 overflow-y-auto border-t p-3">
        <div className="text-muted-foreground px-2 pb-1 text-[11px] font-semibold tracking-wide uppercase">
          {countLabel}
        </div>

        {knowledgeBases.length === 0 ? (
          <div className="text-muted-foreground py-6 text-center text-xs">
            {isLoading
              ? 'Loading knowledge bases…'
              : 'No knowledge bases yet. Create one above.'}
          </div>
        ) : (
          knowledgeBases.map((kb) => {
            const selected = selectedKb?.id === kb.id
            return (
              <div
                role="button"
                tabIndex={0}
                key={kb.id}
                onClick={() => onSelect(kb)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(kb)
                  }
                }}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-left text-sm transition-colors',
                  selected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/40',
                )}
              >
                <Database
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
                >
                  {kb.name}
                </span>
                <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-600 dark:text-violet-400">
                  ID: {kb.id}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(kb.id)
                  }}
                  className="text-muted-foreground hover:text-destructive shrink-0 p-0.5"
                  title="Delete knowledge base"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })
        )}
      </div>
    </PanelCard>
  )
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Database } from 'lucide-react'
import type { KnowledgeBase } from '../types'

interface ActiveKbBarProps {
  selectedKb: KnowledgeBase | null
  chunkCount: number
  documentCount: number
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-right">
      <div className="text-foreground text-2xl font-extrabold tabular-nums">
        {value}
      </div>
      <div className="text-muted-foreground text-xs font-medium">{label}</div>
    </div>
  )
}

/**
 * Context bar summarising the currently selected knowledge base and its
 * chunk / document counts.
 */
export function ActiveKbBar({
  selectedKb,
  chunkCount,
  documentCount,
}: ActiveKbBarProps) {
  return (
    <div className="border-border bg-card flex items-center gap-4 rounded-xl border p-4 shadow-sm">
      <div className="bg-primary/10 text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
        <Database className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
          Active Knowledge Base
        </div>
        <div className="mt-0.5 flex items-center gap-2.5">
          <span className="text-foreground truncate text-lg font-bold">
            {selectedKb ? selectedKb.name : '—'}
          </span>
          <span className="shrink-0 rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-bold text-violet-600 dark:text-violet-400">
            {selectedKb ? `ID: ${selectedKb.id}` : 'none'}
          </span>
        </div>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-6">
        <Stat value={chunkCount} label="Chunks" />
        <div className="bg-border h-8 w-px" />
        <Stat value={documentCount} label="Documents" />
      </div>
    </div>
  )
}

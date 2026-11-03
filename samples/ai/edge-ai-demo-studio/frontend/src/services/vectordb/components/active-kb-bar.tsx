// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Database } from 'lucide-react'
import { TruncatedText } from '@/components/common/truncated-text'
import { Badge } from '@/components/ui/badge'
import type { KnowledgeBase } from '../types'

interface ActiveKbBarProps {
  selectedKb: KnowledgeBase | null
  chunkCount: number
  documentCount: number
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-left sm:text-right">
      <div className="text-foreground text-2xl font-extrabold tabular-nums">
        {value}
      </div>
      <div className="text-muted-foreground text-xs font-medium">{label}</div>
    </div>
  )
}

/** The knowledge base that uploads, added chunks and searches target, with its counts. */
export function ActiveKbBar({
  selectedKb,
  chunkCount,
  documentCount,
}: ActiveKbBarProps) {
  return (
    <section
      aria-label="Active knowledge base"
      data-testid="vectordb-active-kb"
      className="border-primary/30 bg-card flex flex-col gap-4 rounded-xl border p-4 shadow-sm sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <div className="bg-primary/10 text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
          <Database aria-hidden="true" className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Active knowledge base
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2.5">
            {selectedKb ? (
              <TruncatedText
                text={selectedKb.name}
                data-testid="vectordb-active-kb-name"
                className="text-foreground text-lg font-bold"
              />
            ) : (
              <span className="text-muted-foreground text-lg font-bold">
                None selected
              </span>
            )}
            {selectedKb && (
              <Badge tone="primary" className="shrink-0 text-xs font-bold">
                ID: {selectedKb.id}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            {selectedKb
              ? 'Uploads, added chunks and searches go to this knowledge base.'
              : 'Select or create a knowledge base to upload to and search.'}
          </p>
        </div>
      </div>
      {selectedKb && (
        <div className="flex items-center gap-6">
          <Stat value={chunkCount} label="Chunks" />
          <div aria-hidden="true" className="bg-border h-8 w-px" />
          <Stat value={documentCount} label="Documents" />
        </div>
      )}
    </section>
  )
}

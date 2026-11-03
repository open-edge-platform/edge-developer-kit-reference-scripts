// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Download } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import type { ListedModel } from '@/engines/multiserve/types'

function GroupHeading({ label, count }: { label: string; count: number }) {
  return (
    <li
      role="presentation"
      className="text-muted-foreground/70 py-1 text-[10px] font-medium tracking-wider uppercase"
    >
      {label} ({count})
    </li>
  )
}

/** A model added by name: selected, and downloaded when the instance starts. */
function PendingDownloadRow({ repoId }: { repoId: string }) {
  return (
    <li className="border-primary bg-primary/5 ring-primary/20 flex w-full items-center rounded-md border border-dashed p-2 text-left text-xs ring-1">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-1.5">
          <Download
            aria-hidden="true"
            className="text-primary/70 h-3.5 w-3.5 shrink-0"
          />
          <p className="text-foreground/80 truncate font-medium" title={repoId}>
            {repoId}
          </p>
        </div>
        <Badge tone="warning" className="h-4 px-1.5 py-0 text-[10px]">
          <Download aria-hidden="true" className="mr-0.5 h-2.5 w-2.5" />
          Pending download
        </Badge>
      </div>
    </li>
  )
}

/** A pending model added by name, then downloaded and available ones (headed when both exist). */
export function ModelList({
  downloaded,
  available,
  pendingModel,
  search,
  renderRow,
}: {
  downloaded: ListedModel[]
  available: ListedModel[]
  /** The selected model, when it is added by name and not listed yet. */
  pendingModel?: string
  search: string
  renderRow: (model: ListedModel) => ReactNode
}) {
  const hasRows = downloaded.length > 0 || available.length > 0
  return hasRows || pendingModel != null ? (
    <ul
      data-testid="model-list"
      aria-label="Model list"
      className="max-h-80 space-y-1 overflow-y-auto pr-0.5"
    >
      {pendingModel != null && <PendingDownloadRow repoId={pendingModel} />}
      {downloaded.length > 0 && available.length > 0 && (
        <GroupHeading label="Downloaded" count={downloaded.length} />
      )}
      {downloaded.map(renderRow)}
      {available.length > 0 && downloaded.length > 0 && (
        <GroupHeading label="Available" count={available.length} />
      )}
      {available.map(renderRow)}
    </ul>
  ) : (
    <div className="text-muted-foreground rounded-md border border-dashed p-3 text-center text-xs">
      {search ? (
        <>No models match &ldquo;{search}&rdquo;</>
      ) : (
        'No models available for this backend'
      )}
    </div>
  )
}

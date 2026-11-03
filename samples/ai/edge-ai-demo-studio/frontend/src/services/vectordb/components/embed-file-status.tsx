// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Progress } from '@/components/ui/progress'
import { plural } from '@/lib/browser/format'
import type { EmbedFileProgress, EmbedRunProgress } from '../types'

function stageLabel(progress: EmbedFileProgress | undefined): string {
  if (!progress) return 'Starting…'
  const total = progress.chunksTotal ?? 0
  switch (progress.stage) {
    case 'queued':
      return progress.ahead
        ? `Waiting for ${plural(progress.ahead, 'other operation')}…`
        : 'Waiting…'
    case 'loading':
      return 'Reading file…'
    case 'splitting':
      return `Split into ${plural(total, 'chunk')}`
    case 'embedding': {
      const batches =
        progress.batches && progress.batches > 1
          ? ` · batch ${progress.batch ?? 0}/${progress.batches}`
          : ''
      return `Embedded ${progress.chunksDone ?? 0}/${plural(total, 'chunk')}${batches}`
    }
    case 'storing':
      return `Storing ${plural(total, 'chunk')}…`
  }
}

/** Share of the current file done, or `undefined` while that isn't known. */
function stagePercent(progress: EmbedFileProgress | undefined) {
  if (progress?.stage === 'storing') return 100
  if (progress?.stage !== 'embedding' || !progress.chunksTotal) return undefined
  return Math.round(((progress.chunksDone ?? 0) / progress.chunksTotal) * 100)
}

/** The file being embedded: its stage and how many of its chunks are done. */
export function EmbedFileStatus({ run }: { run: EmbedRunProgress }) {
  return (
    <div className="space-y-1" data-testid="embed-file-progress">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-foreground min-w-0 flex-1 truncate">
          {run.file}
        </span>
        <span
          role="status"
          className="text-muted-foreground shrink-0 font-mono text-xs"
        >
          {stageLabel(run.current)}
        </span>
      </div>
      <Progress
        value={stagePercent(run.current)}
        aria-label={`Embedding ${run.file}`}
        className="h-1.5"
      />
    </div>
  )
}

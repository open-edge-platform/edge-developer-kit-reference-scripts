// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Badge } from '@/components/ui/badge'
import type { WorkerModelCatalog } from './use-worker-model-catalog'

interface ModelCatalogNoteProps {
  /** The panel's `useServiceModelCatalog` data. */
  catalog: { kind: string; error?: string } | undefined
}

/**
 * Explains a missing "Downloaded" state (no `modelCatalog`, or the scan failed), so a bare list is
 * not mistaken for "nothing downloaded".
 */
function ModelCatalogNote({ catalog }: ModelCatalogNoteProps) {
  if (catalog?.kind !== 'unsupported') return null
  return (
    <p
      data-testid="cfg-models-catalog-unavailable"
      className="text-muted-foreground text-xs"
    >
      {catalog.error
        ? `Could not check which presets are downloaded: ${catalog.error}`
        : 'Download state is not reported for this worker.'}
    </p>
  )
}

/** "N of M presets downloaded" under a preset list, or why it is not reported. */
export function ModelCatalogSummary({
  catalog,
}: {
  catalog: WorkerModelCatalog
}) {
  return (
    <>
      {catalog.downloadedPresets != null && (
        <p
          data-testid="cfg-models-downloaded-summary"
          className="text-muted-foreground text-xs"
        >
          {catalog.downloadedPresets} of {catalog.presetCount} presets
          downloaded
        </p>
      )}
      <ModelCatalogNote catalog={catalog.catalog} />
    </>
  )
}

/** The "Downloaded" badge of a preset found on disk. */
export function DownloadedBadge({ model }: { model: string }) {
  return (
    <Badge
      data-testid={`cfg-model-downloaded-${model}`}
      variant="outline"
      className="shrink-0 px-1.5 py-0 text-xs"
    >
      Downloaded
    </Badge>
  )
}

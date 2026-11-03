// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader } from 'lucide-react'

/** Model list status while the engine is not up: the engine starting, or why the disk scan failed. */
export function ModelCatalogStatus({
  isWaitingForEngine,
  showLive,
  scanError,
}: {
  isWaitingForEngine: boolean
  /** The list is the engine's own, not the disk scan's. */
  showLive: boolean
  scanError?: string
}) {
  return (
    <>
      {isWaitingForEngine && (
        <p
          role="status"
          data-testid="draft-engine-starting"
          className="text-muted-foreground flex items-center gap-1.5 text-[11px]"
        >
          <Loader aria-hidden="true" className="h-3 w-3 animate-spin" />
          Starting the engine…
        </p>
      )}
      {!showLive && scanError && (
        <p className="text-muted-foreground/70 text-[10px]">
          Could not scan models on disk: {scanError}
        </p>
      )}
    </>
  )
}

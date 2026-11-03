// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Loader } from 'lucide-react'

/** Full-screen blocking overlay shown while an image is being downloaded. */
export function ProcessingOverlay() {
  return (
    <div
      role="status"
      className="animate-in fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm duration-200"
    >
      <div className="bg-card border-border mx-4 flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border p-8 shadow-2xl">
        <div className="relative">
          <div className="bg-primary/20 absolute inset-0 animate-pulse rounded-full blur-xl" />
          <Loader
            className="text-primary relative z-10 h-12 w-12 animate-spin"
            aria-hidden
          />
        </div>
        <div className="space-y-2 text-center">
          <h3 className="text-foreground text-xl font-bold">
            Preparing download…
          </h3>
          <p className="text-muted-foreground text-sm">
            Fetching the image from the worker.
          </p>
        </div>
      </div>
    </div>
  )
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { FolderSync } from 'lucide-react'
import type { Service } from '@/services/types'

export function FileWatcherDemo({ service: _service }: { service: Service }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <div className="bg-muted/40 flex h-16 w-16 items-center justify-center rounded-full">
        <FolderSync className="text-muted-foreground h-8 w-8" />
      </div>
      <p className="text-muted-foreground text-sm">
        File Watcher is running. Connect from a demo that uses the scanner
        feature.
      </p>
    </div>
  )
}

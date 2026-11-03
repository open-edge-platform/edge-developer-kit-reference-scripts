// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Sample } from '@/samples/types'

/**
 * The sample page's heading, description and Export; readiness and actions live in the setup
 * summary. The title's `basis-72` makes Export wrap to its own line rather than squeeze it.
 */
export function SampleHeader({
  sample,
  onExport,
}: {
  sample: Sample
  onExport: () => void
}) {
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <h1 className="text-foreground min-w-0 flex-1 basis-72 text-[28px] leading-tight font-semibold tracking-tight sm:text-[32px]">
          {sample.title}
        </h1>
        <Button variant="outline" className="shrink-0 gap-2" onClick={onExport}>
          <Download className="h-4 w-4" aria-hidden />
          Export
        </Button>
      </div>

      <p className="text-muted-foreground text-sm leading-relaxed sm:text-base">
        {sample.description}
      </p>
    </header>
  )
}

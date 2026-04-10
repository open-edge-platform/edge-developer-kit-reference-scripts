// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ExternalLink, Rocket, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Sample } from '@/samples/types'

export function SampleDemo({ sample }: { sample: Sample }) {
  const { demo } = sample

  // ─── Custom component mode ──────────────────────────────────────────
  if (demo.type === 'component' && demo.component) {
    const DemoComponent = demo.component
    return <DemoComponent sample={sample} />
  }

  // ─── External redirect mode ─────────────────────────────────────
  if (demo.type === 'external' && demo.externalUrl) {
    return (
      <div className="border-border bg-muted/10 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center">
        <div className="bg-primary/10 shadow-primary/5 mb-4 flex h-16 w-16 items-center justify-center rounded-full shadow-sm">
          <Rocket className="text-primary h-8 w-8" />
        </div>
        <h3 className="text-foreground text-lg font-semibold">
          {demo.externalLabel ?? 'Open Demo UI'}
        </h3>
        <p className="text-muted-foreground mt-2 max-w-md text-sm leading-relaxed">
          {demo.externalDescription ??
            'This sample opens in a separate interface. Click below to launch it.'}
        </p>
        <Button
          asChild
          size="lg"
          className="bg-primary hover:bg-primary-light mt-6 gap-2 text-white"
        >
          <a href={demo.externalUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" />
            {demo.externalLabel ?? 'Open Demo'}
          </a>
        </Button>
        <p className="text-muted-foreground mt-3 text-xs">
          Opens at{' '}
          <code className="bg-muted rounded px-1.5 py-0.5 text-[11px]">
            {demo.externalUrl}
          </code>
        </p>
      </div>
    )
  }

  // ─── Fallback: no demo configured ──────────────────────────────
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="bg-muted/40 mb-3 flex h-12 w-12 items-center justify-center rounded-full">
        <Zap className="text-muted-foreground h-6 w-6" />
      </div>
      <p className="text-muted-foreground text-sm">
        Demo not available for this sample.
      </p>
    </div>
  )
}

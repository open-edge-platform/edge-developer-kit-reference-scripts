// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { SlidersHorizontal } from 'lucide-react'
import { TruncatedText } from '@/components/common/truncated-text'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { DemoParameterSidebar } from '@/services/common/demo/components/demo-parameter-sidebar'
import { useParameterPlacement } from '@/services/common/demo/components/parameter-placement'
import type { DemoParam } from '@/types/demo-params'

export const VIDEO_PARAMETERS_LABEL = 'Video parameters'

/** Per-video parameters, kept apart from the runtime settings changed in Configure. */
export function VideoParameters({
  params,
  modelLabel,
  numFrames,
  fps,
}: {
  params: DemoParam[]
  modelLabel: string
  numFrames: number
  fps: number
}) {
  const inSheet = useParameterPlacement() === 'sheet'
  return (
    <section
      aria-labelledby={inSheet ? undefined : 'videogen-params-heading'}
      data-testid="videogen-parameters"
      className={cn(
        'space-y-4',
        !inSheet && 'border-border bg-muted/10 rounded-xl border p-4',
      )}
    >
      <div className="space-y-1">
        {!inSheet && (
          <h2
            id="videogen-params-heading"
            className="text-foreground flex items-center gap-2 text-sm font-medium"
          >
            <span className="bg-primary/10 flex h-6 w-6 items-center justify-center rounded-md">
              <SlidersHorizontal
                className="text-primary h-3.5 w-3.5"
                aria-hidden
              />
            </span>
            {VIDEO_PARAMETERS_LABEL}
          </h2>
        )}
        <p className="text-muted-foreground text-xs">
          Used for each video you generate here.
        </p>
      </div>
      <Separator />
      <DemoParameterSidebar params={params} variant="plain" />
      <p
        className="text-muted-foreground text-xs"
        data-testid="videogen-frames"
      >
        {numFrames} frames at {fps} fps
      </p>
      <Separator />
      <div className="space-y-1 text-xs" data-testid="videogen-runtime-note">
        <p className="text-muted-foreground">Model (runtime setting)</p>
        <TruncatedText
          text={modelLabel || 'Not set'}
          className="text-foreground block font-mono"
        />
        <p className="text-muted-foreground">
          The model, device, backend and precision of this instance are changed
          in Configure.
        </p>
      </div>
    </section>
  )
}

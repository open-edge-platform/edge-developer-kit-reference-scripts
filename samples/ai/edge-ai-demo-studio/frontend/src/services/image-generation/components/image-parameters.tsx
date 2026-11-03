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

export const IMAGE_PARAMETERS_LABEL = 'Image parameters'

/**
 * Per-image parameters, kept apart from the runtime settings changed in Configure. In the
 * narrow-screen sheet, the sheet's title replaces the card's frame and heading.
 */
export function ImageParameters({
  params,
  model,
}: {
  params: DemoParam[]
  model: string
}) {
  const inSheet = useParameterPlacement() === 'sheet'
  return (
    <section
      aria-labelledby={inSheet ? undefined : 'imggen-params-heading'}
      data-testid="imggen-parameters"
      className={cn(
        'space-y-4',
        !inSheet && 'border-border bg-muted/10 rounded-xl border p-4',
      )}
    >
      <div className="space-y-1">
        {!inSheet && (
          <h2
            id="imggen-params-heading"
            className="text-foreground flex items-center gap-2 text-sm font-medium"
          >
            <span className="bg-primary/10 flex h-6 w-6 items-center justify-center rounded-md">
              <SlidersHorizontal
                className="text-primary h-3.5 w-3.5"
                aria-hidden
              />
            </span>
            {IMAGE_PARAMETERS_LABEL}
          </h2>
        )}
        <p className="text-muted-foreground text-xs">
          Used for each image you generate or edit here.
        </p>
      </div>
      <Separator />
      <DemoParameterSidebar params={params} variant="plain" />
      <Separator />
      <div className="space-y-1 text-xs" data-testid="imggen-runtime-note">
        <p className="text-muted-foreground">Model (runtime setting)</p>
        <TruncatedText
          text={model || 'Not set'}
          className="text-foreground block font-mono"
        />
        <p className="text-muted-foreground">
          The model, device and other runtime settings of this instance are
          changed in Configure.
        </p>
      </div>
    </section>
  )
}

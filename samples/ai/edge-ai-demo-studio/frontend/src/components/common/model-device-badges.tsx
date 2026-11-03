// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Box, Cpu, Download } from 'lucide-react'
import { TruncatedText } from '@/components/common/truncated-text'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface ModelDeviceBadgesProps {
  model?: string
  /** Labelled, roomier badges for the selected instance's toolbar. */
  appearance?: 'compact' | 'toolbar'
  device?: string
  backend?: string
  /** Max-width class for the model badge (its truncation point differs by caller). */
  modelMaxWidthClass?: string
  className?: string
}

/** Model, device and backend badges; a cut model name shows in full on hover, focus or tap. */
export function ModelDeviceBadges({
  model,
  appearance = 'compact',
  device,
  backend,
  modelMaxWidthClass = 'max-w-[160px]',
  className,
}: ModelDeviceBadgesProps) {
  if (!model && !device && !backend) return null

  const toolbar = appearance === 'toolbar'
  const ModelIcon = toolbar ? Box : Download
  const toolbarSize = 'h-7 gap-1.5 rounded-md px-2.5 text-xs'

  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-1.5',
        toolbar && 'gap-2',
        className,
      )}
    >
      {model && (
        <Badge
          tone="primary"
          className={cn(
            'inline-flex min-w-0 items-center gap-1 text-xs font-medium',
            toolbar && toolbarSize,
            modelMaxWidthClass,
          )}
          data-testid="model-badge"
        >
          <ModelIcon aria-hidden="true" className="h-3 w-3 shrink-0" />
          {toolbar ? (
            <span className="shrink-0 font-normal opacity-75">Model</span>
          ) : (
            <span className="sr-only">Model:</span>
          )}
          <TruncatedText text={model} />
        </Badge>
      )}
      {device && (
        <Badge
          tone="info"
          className={cn(
            'inline-flex items-center gap-1 text-xs font-medium',
            toolbar && toolbarSize,
          )}
          title={
            device.toUpperCase() === 'AUTO'
              ? 'Automatic accelerator selection'
              : device
          }
        >
          <Cpu aria-hidden="true" className="h-3 w-3 shrink-0" />
          {toolbar ? (
            <span className="font-normal opacity-75">Accelerator</span>
          ) : (
            <span className="sr-only">Accelerator:</span>
          )}
          {device}
        </Badge>
      )}
      {backend && (
        <Badge
          tone="muted"
          className="inline-flex items-center text-xs font-medium"
        >
          {backend}
        </Badge>
      )}
    </div>
  )
}

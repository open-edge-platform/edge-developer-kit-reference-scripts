// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { cn } from '@/lib/utils'
import type { OcrRegion } from '../hooks'

interface OcrImageOverlayProps {
  imageUrl: string
  naturalWidth: number
  naturalHeight: number
  regions: OcrRegion[]
  highlightIndex?: number | null
  onRegionHover?: (index: number | null) => void
}

export function OcrImageOverlay({
  imageUrl,
  naturalWidth,
  naturalHeight,
  regions,
  highlightIndex,
  onRegionHover,
}: OcrImageOverlayProps) {
  const boxed = regions
    .map((r, i) => ({ region: r, index: i }))
    .filter((r) => r.region.box && r.region.box.length > 0)

  const hasBoxes = boxed.length > 0
  const stroke = Math.max(2, Math.max(naturalWidth, naturalHeight) / 300)

  return (
    <div className="space-y-2">
      <div className="bg-muted/30 relative overflow-hidden rounded-lg border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="OCR source"
          className="block h-auto max-h-[32rem] w-full object-contain"
        />
        {hasBoxes && naturalWidth > 0 && naturalHeight > 0 && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 ${naturalWidth} ${naturalHeight}`}
            preserveAspectRatio="xMidYMid meet"
          >
            {boxed.map(({ region, index }) => (
              <polygon
                key={index}
                points={(region.box ?? [])
                  .map(([x, y]) => `${x},${y}`)
                  .join(' ')}
                className={cn(
                  'pointer-events-auto cursor-pointer transition-colors',
                  index === highlightIndex
                    ? 'fill-primary/30 stroke-primary'
                    : 'fill-primary/10 stroke-primary hover:fill-primary/20',
                )}
                strokeWidth={stroke}
                onMouseEnter={() => onRegionHover?.(index)}
                onMouseLeave={() => onRegionHover?.(null)}
              />
            ))}
          </svg>
        )}
      </div>
      {!hasBoxes && regions.length > 0 && (
        <p className="text-muted-foreground text-xs">
          This model returns text without bounding boxes.
        </p>
      )}
    </div>
  )
}

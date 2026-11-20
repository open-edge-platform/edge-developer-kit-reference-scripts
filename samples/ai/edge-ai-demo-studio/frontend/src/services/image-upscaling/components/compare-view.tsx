// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import { RefImage } from '@/components/common/ref-media'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'

const ZOOM_OPTIONS = [
  { value: '1', label: 'Fit' },
  { value: '2', label: '2×' },
  { value: '4', label: '4×' },
]

/** The tallest the frame gets at Fit; a square or portrait image is narrowed to stay within it. */
const FIT_HEIGHT_REM = 28

/**
 * The input and its upscaled version in one frame, split by a divider: the input on the left (as
 * the browser resizes it), the model's output on the right. At Fit the whole image shows; zoomed
 * in, the frame scrolls, so the detail the model restored can be compared pixel for pixel.
 */
export function CompareView({
  beforeUrl,
  afterUrl,
  width,
  height,
  testIdPrefix,
}: {
  beforeUrl: string
  afterUrl: string
  /** The output's size: sets the frame's aspect ratio. */
  width: number
  height: number
  testIdPrefix: string
}) {
  const [position, setPosition] = useState(50)
  const [zoom, setZoom] = useState('1')
  const fit = zoom === '1'

  return (
    <div className="space-y-3">
      <div
        // At Fit nothing overflows but a rounding sliver, which would only add a scrollbar.
        className={`bg-muted/50 rounded-md ${fit ? 'overflow-hidden' : 'overflow-auto'}`}
        style={{ maxHeight: `${FIT_HEIGHT_REM}rem` }}
        data-testid={`${testIdPrefix}-compare`}
      >
        <div
          className="relative mx-auto"
          data-testid={`${testIdPrefix}-compare-frame`}
          style={{
            // At Fit: the full width, unless that would make the frame taller than the box.
            width: `calc(${zoom} * min(100%, ${(FIT_HEIGHT_REM * width) / height}rem))`,
            aspectRatio: `${width} / ${height}`,
          }}
        >
          <RefImage
            src={beforeUrl}
            alt="Input, resized by the browser"
            className="absolute inset-0 h-full w-full"
          />
          <RefImage
            src={afterUrl}
            alt="Upscaled"
            className="absolute inset-0 h-full w-full"
            style={{ clipPath: `inset(0 0 0 ${position}%)` }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_4px_rgba(0,0,0,0.6)]"
            style={{ left: `${position}%` }}
          />
          <span className="pointer-events-none absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
            Input
          </span>
          <span className="pointer-events-none absolute top-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
            Upscaled
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Slider
          value={[position]}
          onValueChange={([value]) => setPosition(value)}
          min={0}
          max={100}
          step={1}
          aria-label="Divider between the input and the upscaled image"
          className="flex-1"
        />
        <Label
          htmlFor={`${testIdPrefix}-zoom`}
          className="text-muted-foreground shrink-0 text-xs"
        >
          Zoom
        </Label>
        <Select value={zoom} onValueChange={setZoom}>
          <SelectTrigger id={`${testIdPrefix}-zoom`} className="w-20 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ZOOM_OPTIONS.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="text-xs"
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { CheckCircle2, Crop, RotateCcw, ScanSearch } from 'lucide-react'
import Image from 'next/image'
import type { ReactNode } from 'react'
import { TONES, type Tone } from '@/components/common/tones'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { SegmentationMeta } from '../lib/api'
import type { ClassificationResult } from '../lib/classification'

const LABEL_TONES: Tone[] = [
  'destructive',
  'success',
  'info',
  'warning',
  'primary',
]

/** The tone of `label`, by its place among the classifier's labels. */
export function labelTone(label: string, workerLabels: string[]): Tone {
  const index =
    workerLabels.length === 0
      ? 2
      : Math.max(
          0,
          workerLabels.map((l) => l.toLowerCase()).indexOf(label.toLowerCase()),
        )
  return LABEL_TONES[index % LABEL_TONES.length]
}

/** The original image, and the masked region that was classified. */
export function ResultImages({
  result,
  layout,
}: {
  result: ClassificationResult
  /** `cards`: one card each (result view); `stacked`: compact (refine view). */
  layout: 'cards' | 'stacked'
}) {
  const height = layout === 'cards' ? 288 : 224
  const images = [
    {
      key: 'original',
      icon: ScanSearch,
      title: layout === 'cards' ? 'Original Image' : 'Original',
      src: result.originalImageUrl,
      alt: 'Original image',
      frame: 'border',
    },
    {
      key: 'masked',
      icon: Crop,
      title: 'Segmentation Mask Applied',
      src: result.croppedImageUrl,
      alt: 'Masked segment',
      frame: 'border-primary/40 border-2',
    },
  ]

  return (
    <div className={layout === 'cards' ? 'space-y-4' : 'space-y-3'}>
      {images.map(({ key, icon: Icon, title, src, alt, frame }) => (
        <figure
          key={key}
          className={cn(
            layout === 'cards'
              ? 'bg-card space-y-2 rounded-xl border p-4'
              : 'space-y-1.5',
          )}
        >
          <figcaption className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {title}
          </figcaption>
          <div className={cn('bg-muted/30 overflow-hidden rounded-lg', frame)}>
            <Image
              src={src}
              alt={alt}
              width={400}
              height={height}
              className={cn(
                'mx-auto w-full object-contain',
                layout === 'cards' ? 'max-h-72' : 'max-h-56',
              )}
            />
          </div>
        </figure>
      ))}
    </div>
  )
}

/** How many objects the mask combines, its area, and the segment's label. */
export function SegmentInfo({
  segmentation,
  compact = false,
}: {
  segmentation: SegmentationMeta
  /** Two columns of small text (refine view) instead of rows. */
  compact?: boolean
}) {
  const topLabel = segmentation.labels[0]
  const rows: { label: string; value: ReactNode; wide?: boolean }[] = [
    {
      label: compact ? 'Objects' : 'Objects detected',
      value: segmentation.num_objects ?? 1,
    },
    {
      label: compact ? 'Masked Area' : 'Masked area',
      value: `${segmentation.area_px.toLocaleString()} px²`,
    },
  ]
  if (topLabel) {
    rows.push({
      label: 'Seg label',
      wide: true,
      value: (
        <span className="capitalize">
          {topLabel.label}{' '}
          <span className="text-muted-foreground font-normal">
            ({topLabel.confidence}%)
          </span>
        </span>
      ),
    })
  }

  return (
    <dl
      className={
        compact ? 'grid grid-cols-2 gap-x-4 gap-y-1 text-xs' : 'space-y-2'
      }
    >
      {rows.map(({ label, value, wide }) => (
        <div
          key={label}
          className={cn(
            'flex justify-between',
            compact
              ? wide && 'col-span-2'
              : 'bg-muted/30 items-center rounded-lg px-3 py-2 text-sm',
          )}
        >
          <dt className="text-muted-foreground">{label}</dt>
          <dd
            className={compact ? 'font-medium' : 'font-semibold tabular-nums'}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Feedback sent: what happened, and on to the next image. */
export function FeedbackSuccess({
  title,
  children,
  onNext,
}: {
  title: string
  children: ReactNode
  onNext: () => void
}) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-4 py-6 text-center"
    >
      <div
        className={cn(
          'flex h-14 w-14 items-center justify-center rounded-full',
          TONES.success.iconBg,
        )}
      >
        <CheckCircle2 className="h-7 w-7" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="text-success-strong font-semibold">{title}</p>
        {children}
      </div>
      <Button variant="outline" className="mt-2 gap-2" onClick={onNext}>
        <RotateCcw className="h-4 w-4" aria-hidden />
        Classify Another Image
      </Button>
    </div>
  )
}

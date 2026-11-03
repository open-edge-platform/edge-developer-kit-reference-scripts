// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ImageIcon } from 'lucide-react'
import Image from 'next/image'
import type { Sample } from '@/samples/types'

/** A sample's preview image filling its (relatively positioned) frame; decorative, so `alt=""`. */
export function SamplePreviewImage({
  sample,
  sizes,
  priority,
  className,
}: {
  sample: Sample
  sizes: string
  priority?: boolean
  className?: string
}) {
  if (!sample.image) {
    return (
      <div className="from-primary/20 via-primary/10 to-intel-teal/5 flex h-full w-full items-center justify-center bg-gradient-to-br">
        <ImageIcon className="text-muted-foreground/40 h-8 w-8" aria-hidden />
      </div>
    )
  }
  return (
    <Image
      src={sample.image}
      alt=""
      fill
      priority={priority}
      className={className}
      sizes={sizes}
    />
  )
}

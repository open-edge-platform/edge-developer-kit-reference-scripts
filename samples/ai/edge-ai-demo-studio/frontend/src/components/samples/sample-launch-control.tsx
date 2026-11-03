// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ExternalLink, Play } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Sample } from '@/samples/types'

/** "Launch demo", or the external demo's link. Shown disabled rather than hidden when unverified. */
export function SampleLaunchControl({
  sample,
  disabled = false,
}: {
  sample: Sample
  disabled?: boolean
}) {
  const className = cn('gap-2', disabled && 'pointer-events-none opacity-60')

  if (sample.demo.type === 'external' && sample.demo.externalUrl) {
    return (
      <Button asChild size="sm" className={className}>
        <a
          href={disabled ? undefined : sample.demo.externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : undefined}
        >
          <ExternalLink className="h-4 w-4" aria-hidden />
          {sample.demo.externalLabel ?? 'Open demo'}
        </a>
      </Button>
    )
  }

  return (
    <Button asChild size="sm" className={className}>
      <Link
        data-testid="launch-button"
        href={disabled ? '#' : `/samples/${sample.id}/demo`}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
      >
        <Play className="h-4 w-4" aria-hidden />
        Launch demo
      </Link>
    </Button>
  )
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ArrowLeft, Ban, Cpu, Monitor } from 'lucide-react'
import Link from 'next/link'
import { EmptyState } from '@/components/common/empty-state'
import { TONES } from '@/components/common/tones'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { safeHref, HREF_CHARS } from '@/lib/validation'
import type { SampleCompatibility } from '@/samples/common/readiness'
import type { Sample } from '@/samples/types'
import { getOSLabel } from '@/types/common'
import { useGalleryReturnHref } from './gallery-state'

interface SampleCompatibilityNoticeProps {
  sample: Sample
  compatibility: SampleCompatibility
  /** `inline`: a notice above a still-readable page; `panel`: replaces a workspace that cannot run. */
  variant?: 'inline' | 'panel'
}

/** Why this machine cannot run the sample, and a way back to the gallery. */
export function SampleCompatibilityNotice({
  sample,
  compatibility,
  variant = 'inline',
}: SampleCompatibilityNoticeProps) {
  const browseSamplesHref = useGalleryReturnHref()
  let safeBrowseSamplesHref = ''
  for (const ch of safeHref(browseSamplesHref)) {
    let ok = ''
    for (const allowed of HREF_CHARS)
      if (allowed === ch) {
        ok = allowed
        break
      }
    if (!ok) {
      safeBrowseSamplesHref = '/'
      break
    }
    safeBrowseSamplesHref += ok
  }

  const facts = (
    <dl className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-1 text-xs">
      {compatibility.supportedOS.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Monitor className="h-3.5 w-3.5" aria-hidden />
          <dt>Supported on</dt>
          <dd className="text-foreground font-medium">
            {compatibility.supportedOS.map(getOSLabel).join(', ')}
          </dd>
        </div>
      )}
      {sample.requiredDevices && sample.requiredDevices.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Cpu className="h-3.5 w-3.5" aria-hidden />
          <dt>Required devices</dt>
          <dd className="text-foreground font-medium">
            {sample.requiredDevices.map((d) => d.toUpperCase()).join(', ')}
          </dd>
        </div>
      )}
    </dl>
  )

  if (variant === 'panel') {
    return (
      <div className="space-y-6">
        <Link
          href={`/samples/${sample.id}`}
          className="group text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm transition-colors"
        >
          <ArrowLeft
            className="h-4 w-4 transition-transform group-hover:-translate-x-0.5"
            aria-hidden
          />
          Back to {sample.title}
        </Link>
        <EmptyState
          icon={Ban}
          tone="warning"
          title="This sample can’t run on this device"
          description={compatibility.reason}
        >
          <div className="mt-4">{facts}</div>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild variant="outline">
              <Link href={`/samples/${sample.id}`}>View requirements</Link>
            </Button>
            <Button asChild>
              <Link href={safeBrowseSamplesHref}>Browse samples</Link>
            </Button>
          </div>
        </EmptyState>
      </div>
    )
  }

  return (
    <div
      role="note"
      className={cn(
        'flex flex-wrap items-start gap-3 rounded-xl border p-4',
        TONES.warning.surface,
      )}
    >
      <Ban
        className={cn('mt-0.5 h-5 w-5 shrink-0', TONES.warning.text)}
        aria-hidden
      />
      <div className="min-w-48 flex-1 space-y-2">
        <div>
          <p className="text-foreground text-sm font-semibold">
            This sample can&rsquo;t run on this device
          </p>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {compatibility.reason}. You can still read what it does and how it
            works.
          </p>
        </div>
        {facts}
      </div>
      <Button asChild variant="outline" size="sm">
        <Link href={safeBrowseSamplesHref}>Browse samples</Link>
      </Button>
    </div>
  )
}

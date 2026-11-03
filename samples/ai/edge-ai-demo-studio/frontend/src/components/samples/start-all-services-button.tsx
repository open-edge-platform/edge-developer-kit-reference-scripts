// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader, Play, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  useServiceActivity,
  useServiceStatus,
} from '@/context/service-status-context'
import { cn } from '@/lib/utils'
import type { SampleDependencyView } from '@/samples/common/readiness'

interface StartAllServicesButtonProps {
  /** Started through their resolved key; ones not added yet are left to their Set up action. */
  dependencies: SampleDependencyView[]
  label?: string
  /** Wording while a start is in flight or a service is still coming up. */
  busyLabel?: string
  size?: 'sm' | 'default' | 'lg'
  className?: string
  'data-testid'?: string
}

/** Starts every stopped service and restarts every failed one, in one click. */
export function StartAllServicesButton({
  dependencies,
  label = 'Start required services',
  busyLabel = 'Starting services…',
  size = 'sm',
  className,
  'data-testid': testId,
}: StartAllServicesButtonProps) {
  const { startService, restartService } = useServiceStatus()
  const { isActionPending } = useServiceActivity()

  // A dependency's status is its resolved instance's (`d.key`).
  const added = dependencies.filter((d) => d.status !== 'missing')
  const notOnline = added.filter((d) => d.status !== 'online')
  const stopped = notOnline.filter((d) => d.status === 'offline')
  const failed = notOnline.filter((d) => d.status === 'error')

  const anyPending = added.some((d) => isActionPending(d.key))
  const anyStarting = notOnline.some((d) => d.status === 'starting')
  const isBusy = anyPending || anyStarting
  const actionable = stopped.length + failed.length

  const handleStartAll = () => {
    if (isBusy) return
    // A failed request has already been reported in a toast.
    for (const d of stopped) startService(d.key).catch(() => {})
    for (const d of failed) restartService(d.key).catch(() => {})
  }

  if (notOnline.length === 0) return null

  const retryOnly = stopped.length === 0 && failed.length > 0
  const idleLabel = retryOnly
    ? failed.length === 1
      ? 'Retry failed service'
      : 'Retry failed services'
    : label

  return (
    <Button
      onClick={handleStartAll}
      disabled={actionable === 0 || isBusy}
      aria-busy={isBusy || undefined}
      size={size}
      className={cn('gap-2', className)}
      data-testid={testId}
    >
      {isBusy ? (
        <Loader className="animate-spin" aria-hidden />
      ) : retryOnly ? (
        <RotateCcw aria-hidden />
      ) : (
        <Play aria-hidden />
      )}
      <span className="stable-label">
        <span className={cn(isBusy && 'invisible')} aria-hidden={isBusy}>
          {idleLabel}
        </span>
        <span className={cn(!isBusy && 'invisible')} aria-hidden={!isBusy}>
          {busyLabel}
        </span>
      </span>
    </Button>
  )
}

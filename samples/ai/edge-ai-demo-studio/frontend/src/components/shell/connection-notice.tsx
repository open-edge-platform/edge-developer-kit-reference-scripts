// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader, RefreshCw, WifiOff } from 'lucide-react'
import { TONES } from '@/components/common/tones'
import { Button } from '@/components/ui/button'
import {
  useServiceActivity,
  useServiceStatus,
} from '@/context/service-status-context'
import { cn } from '@/lib/utils'

export function ConnectionNotice() {
  const { connectionError, refreshServices } = useServiceStatus()
  const { refreshing } = useServiceActivity()
  if (!connectionError) return null
  return (
    <div
      role="alert"
      className={cn(
        'mb-6 flex flex-wrap items-center gap-3 rounded-xl border p-4',
        TONES.warning.surface,
      )}
    >
      <WifiOff
        aria-hidden="true"
        className={cn('size-5 shrink-0', TONES.warning.text)}
      />
      <div className="min-w-48 flex-1">
        <p className="text-sm font-semibold">Unable to update service status</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Service information may be out of date. Check your connection and try
          again.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={refreshServices}
        disabled={refreshing}
      >
        {refreshing ? <Loader className="animate-spin" /> : <RefreshCw />}
        {refreshing ? 'Retrying…' : 'Retry connection'}
      </Button>
    </div>
  )
}

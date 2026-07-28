// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader2, Play } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { useServiceStatus } from '@/context/service-status-context'

interface StartAllServicesButtonProps {
  serviceIds: string[]
  label?: string
  className?: string
}

export function StartAllServicesButton({
  serviceIds,
  label = 'Start All Services',
  className,
}: StartAllServicesButtonProps) {
  const { serviceById, startService, isActionPending } = useServiceStatus()

  const statusOf = useCallback(
    (id: string) => serviceById.get(id)?.status,
    [serviceById],
  )

  const notOnline = useMemo(
    () => serviceIds.filter((id) => statusOf(id) !== 'online'),
    [serviceIds, statusOf],
  )

  const actionable = useMemo(
    () =>
      notOnline.filter((id) => {
        const st = statusOf(id)
        return st === 'offline' || st === 'error'
      }),
    [notOnline, statusOf],
  )

  const anyPending = serviceIds.some((id) => isActionPending(id))
  const anyStarting = notOnline.some((id) => statusOf(id) === 'starting')
  const isBusy = anyPending || anyStarting

  const handleStartAll = useCallback(() => {
    for (const id of actionable) {
      startService(id)
    }
  }, [actionable, startService])

  if (notOnline.length === 0) return null

  return (
    <Button
      onClick={handleStartAll}
      disabled={actionable.length === 0 || isBusy}
      size="sm"
      className={className}
    >
      {isBusy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Play className="h-3.5 w-3.5" />
      )}
      {label}
    </Button>
  )
}

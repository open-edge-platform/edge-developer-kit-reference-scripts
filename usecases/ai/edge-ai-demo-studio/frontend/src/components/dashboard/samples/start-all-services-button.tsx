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
  const { statusMap, startService, isActionPending } = useServiceStatus()

  // Services that still need to reach 'online' (not yet online)
  const notOnline = useMemo(
    () => serviceIds.filter((id) => statusMap[id] !== 'online'),
    [serviceIds, statusMap],
  )

  // Services that can actually be triggered (offline/error — not already starting)
  const actionable = useMemo(
    () =>
      notOnline.filter((id) => {
        const st = statusMap[id]
        return st === 'offline' || st === 'error'
      }),
    [notOnline, statusMap],
  )

  const anyPending = serviceIds.some((id) => isActionPending(id))
  const anyStarting = notOnline.some((id) => statusMap[id] === 'starting')
  const isBusy = anyPending || anyStarting

  const handleStartAll = useCallback(() => {
    for (const id of actionable) {
      startService(id)
    }
  }, [actionable, startService])

  // Hide once all required services are online
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

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader2, Play } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { useServiceStatus } from '@/context/service-status-context'

interface StartAllServicesButtonProps {
  serviceIds: string[]
  deviceMap?: Record<string, string>
  label?: string
  className?: string
}

export function StartAllServicesButton({
  serviceIds,
  deviceMap,
  label = 'Start All Services',
  className,
}: StartAllServicesButtonProps) {
  const { statusMap, startService, configureAndStartService, isActionPending } =
    useServiceStatus()

  const notOnline = useMemo(
    () => serviceIds.filter((id) => statusMap[id] !== 'online'),
    [serviceIds, statusMap],
  )

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
      const device = deviceMap?.[id]
      if (device) {
        configureAndStartService(id, device)
      } else {
        startService(id)
      }
    }
  }, [actionable, deviceMap, startService, configureAndStartService])

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

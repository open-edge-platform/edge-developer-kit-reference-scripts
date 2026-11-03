// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { RotateCcw } from 'lucide-react'
import { describeUnappliedSettings } from '@/components/configure/applied-settings'
import { useInterruptionGuard } from '@/components/services/instance-lifecycle'
import { Button } from '@/components/ui/button'
import {
  useServiceActivity,
  useServiceStatus,
} from '@/context/service-status-context'
import type { ServiceInstance } from '@/services/types'

/**
 * Offers a restart while the instance runs settings older than its saved ones. The server makes
 * that comparison, so every tab and reload agrees.
 */
export function RestartToApply({ instance }: { instance: ServiceInstance }) {
  const { restartService } = useServiceStatus()
  const { isActionPending } = useServiceActivity()
  const { guard, dialog } = useInterruptionGuard()
  const unapplied = describeUnappliedSettings(instance)
  if (unapplied.length === 0 || instance.status !== 'online') return null

  // A failure is already reported as a toast.
  const restart = () =>
    guard([instance], 'restart', () => {
      restartService(instance.instanceKey).catch(() => {})
    })
  const names = unapplied.map((d) => d.label.toLowerCase()).join(', ')
  return (
    <>
      <span className="text-warning text-xs" data-testid="settings-not-applied">
        Saved settings not running yet
        <span className="sr-only"> ({names})</span>
      </span>
      <Button
        type="button"
        size="xs"
        variant="outline"
        className="border-warning/40 text-warning hover:text-warning"
        disabled={isActionPending(instance.instanceKey)}
        onClick={restart}
        data-testid="restart-to-apply"
      >
        <RotateCcw aria-hidden="true" />
        Restart to apply
      </Button>
      {dialog}
    </>
  )
}

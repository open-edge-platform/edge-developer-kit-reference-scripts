// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useServiceStatus } from '@/context/service-status-context'
import { useStartInstances } from '@/hooks/use-instances'
import type { InstanceTab } from '@/lib/instances/service-presentation'
import type { ServiceInstance } from '@/services/types'

function rowIds(instances: readonly ServiceInstance[]): number[] {
  return instances.map((i) => i.dbId)
}

function namesOf(instances: readonly ServiceInstance[]): string {
  return instances.map((i) => i.label).join(', ')
}

/** "2 started · 1 failed": the parts of a bulk action's outcome that happened. */
function outcomeSummary(parts: [count: number, what: string][]): string {
  return parts
    .filter(([count]) => count > 0)
    .map(([count, what]) => `${count} ${what}`)
    .join(' · ')
}

/** Bulk Start/Stop, each reported in one toast (a failed start links to its logs via `onOpen`). */
export function useBulkInstanceActions(
  instances: ServiceInstance[],
  onOpen: (instanceId: string, tab?: InstanceTab) => void,
) {
  const { stopService } = useServiceStatus()
  const { mutate: startInstances, isPending: starting } = useStartInstances()
  const [stopping, setStopping] = useState(false)

  const byRowIds = (ids: number[]) =>
    instances.filter((i) => ids.includes(i.dbId))

  const start = (toStart: ServiceInstance[]) => {
    // One bulk action at a time, so a stop never races the serial start.
    startInstances(rowIds(toStart), {
      onSuccess: ({ started, starting: still, failed }) => {
        const message = outcomeSummary([
          [started.length, 'started'],
          [still.length, 'still starting'],
          [failed.length, 'failed'],
        ])
        const notStarted = byRowIds(failed)
        if (notStarted.length > 0) {
          const firstFailed = notStarted[0]
          toast.error(message, {
            description: `Not started: ${namesOf(notStarted)}`,
            action: {
              label: 'View logs',
              onClick: () => onOpen(firstFailed.instanceId, 'logs'),
            },
          })
        } else {
          toast.success(message)
        }
      },
    })
  }

  const stop = async (toStop: ServiceInstance[]) => {
    setStopping(true)
    try {
      // Silent: one summary below reports every failure, not a toast each.
      const results = await Promise.allSettled(
        toStop.map((i) => stopService(i.instanceKey, { silent: true })),
      )
      const failed = toStop.filter(
        (_, idx) => results[idx].status === 'rejected',
      )
      const message = outcomeSummary([
        [toStop.length - failed.length, 'stopped'],
        [failed.length, 'failed'],
      ])
      if (failed.length > 0) {
        toast.error(message, { description: `Not stopped: ${namesOf(failed)}` })
      } else {
        toast.success(message)
      }
    } finally {
      setStopping(false)
    }
  }

  return { start, stop, starting, stopping }
}

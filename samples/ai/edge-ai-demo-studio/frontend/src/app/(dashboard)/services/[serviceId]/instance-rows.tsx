// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useInterruptionGuard } from '@/components/services/instance-lifecycle'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import type { InstanceTab } from '@/lib/instances/service-presentation'
import type { ServiceInstance } from '@/services/types'
import { InstanceBulkToolbar } from './instance-bulk-toolbar'
import { InstanceRow } from './instance-row'
import { useBulkInstanceActions } from './use-bulk-instance-actions'
import { useInstanceSelection } from './use-instance-selection'

/** The Manage instances sheet's body. Stopping instances a session is using asks first. */
export function InstanceRows({
  instances,
  shownInstanceKey,
  onOpen,
  onDuplicated,
  onDeleted,
}: {
  instances: ServiceInstance[]
  shownInstanceKey?: string
  onOpen: (instanceId: string, tab?: InstanceTab) => void
  onDuplicated: (instanceId: string) => void
  onDeleted: (instance: ServiceInstance) => void
}) {
  const { guard, dialog } = useInterruptionGuard()
  const { checked, selected, toStart, toStop, allChecked, toggle, setAll } =
    useInstanceSelection(instances)
  const { start, stop, starting, stopping } = useBulkInstanceActions(
    instances,
    onOpen,
  )

  return (
    <>
      <InstanceBulkToolbar
        selectedCount={selected.length}
        allChecked={allChecked}
        onCheckAll={setAll}
        startCount={toStart.length}
        stopCount={toStop.length}
        starting={starting}
        stopping={stopping}
        onStart={() => start(toStart)}
        onStop={() => guard(toStop, 'stop', () => void stop(toStop))}
      />

      <ScrollArea className="min-h-0 flex-1">
        <ul className="divide-border divide-y" aria-label="Instances">
          {instances.map((instance) => (
            <InstanceRow
              key={instance.instanceKey}
              instance={instance}
              siblings={instances}
              checked={checked.has(instance.instanceKey)}
              onCheckedChange={(on) => toggle(instance.instanceKey, on)}
              isShown={instance.instanceKey === shownInstanceKey}
              onOpen={(tab) => onOpen(instance.instanceId, tab)}
              onDuplicated={onDuplicated}
              onDeleted={() => onDeleted(instance)}
            />
          ))}
        </ul>
      </ScrollArea>
      {dialog}
    </>
  )
}

export function InstanceRowsSkeleton() {
  return (
    <div aria-busy="true" className="divide-border divide-y">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          className="flex items-center gap-3 px-5 py-4"
        >
          <Skeleton className="size-4 rounded" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
      ))}
    </div>
  )
}

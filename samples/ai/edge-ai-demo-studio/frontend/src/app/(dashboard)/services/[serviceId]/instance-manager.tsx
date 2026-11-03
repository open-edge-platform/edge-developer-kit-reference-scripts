// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { NewInstanceSheet } from '@/components/services/new-instance-sheet'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  useServiceInstances,
  useServiceStatus,
} from '@/context/service-status-context'
import {
  addInstanceAvailability,
  type InstanceTab,
  instanceSummary,
} from '@/lib/instances/service-presentation'
import type { ServiceInstance } from '@/services/types'
import { InstanceRows, InstanceRowsSkeleton } from './instance-rows'

/**
 * Manage instances sheet. An instance added or duplicated here closes the sheet and opens, so the
 * workspace never changes behind it unseen.
 */
export function InstanceManagerSheet({
  serviceType,
  open,
  onOpenChange,
  shownInstanceKey,
  onOpen,
  onCreated,
  onDeleted,
}: {
  serviceType: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The instance the workspace shows. */
  shownInstanceKey?: string
  /** Shows an instance in the workspace, optionally on one tab. */
  onOpen: (instanceId: string, tab?: InstanceTab) => void
  /** Shows an instance just created here (and closes the sheet). */
  onCreated: (instanceId: string) => void
  onDeleted: (instance: ServiceInstance) => void
}) {
  const { loading } = useServiceStatus()
  const instances = useServiceInstances(serviceType)
  const first = instances[0]
  const availability = addInstanceAvailability({
    multiInstance: first?.multiInstance,
    maxInstances: first?.maxInstances,
    instances,
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton
        className="flex h-full min-h-0 w-full flex-col gap-0 p-0 sm:max-w-[640px]"
        data-testid="instance-manager"
      >
        <SheetHeader className="border-border border-b px-5 pt-5 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pr-8">
            <SheetTitle className="text-base">Manage instances</SheetTitle>
            {availability.allowed && (
              <NewInstanceSheet
                serviceType={serviceType}
                onCreated={(doc) => onCreated(doc.instanceId)}
              />
            )}
          </div>
          <SheetDescription
            className="text-xs"
            data-testid="instance-manager-summary"
          >
            {loading ? 'Loading instances…' : instanceSummary(instances)}
          </SheetDescription>
          {!loading && !availability.allowed && (
            <p
              className="text-muted-foreground text-xs"
              data-testid="instance-limit-note"
            >
              {availability.reason}
            </p>
          )}
        </SheetHeader>

        {loading ? (
          <InstanceRowsSkeleton />
        ) : (
          <InstanceRows
            instances={instances}
            shownInstanceKey={shownInstanceKey}
            onOpen={(instanceId, tab) => {
              onOpen(instanceId, tab)
              onOpenChange(false)
            }}
            onDuplicated={onCreated}
            onDeleted={onDeleted}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

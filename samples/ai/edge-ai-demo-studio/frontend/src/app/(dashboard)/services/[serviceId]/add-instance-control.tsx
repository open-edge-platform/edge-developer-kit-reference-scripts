// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Plus } from 'lucide-react'
import { NewInstanceSheet } from '@/components/services/new-instance-sheet'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { addInstanceAvailability } from '@/lib/instances/service-presentation'
import type { ServiceInstance } from '@/services/types'

/** Add instance button, disabled with the reason when the service can't have another. */
export function AddInstanceControl({
  serviceId,
  selected,
  instances,
  onCreated,
}: {
  serviceId: string
  selected: ServiceInstance
  instances: ServiceInstance[]
  onCreated: (instanceId: string) => void
}) {
  const availability = addInstanceAvailability({
    multiInstance: selected.multiInstance,
    maxInstances: selected.maxInstances,
    instances,
  })
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={!availability.allowed}
      data-testid="bar-add-instance"
      aria-label="Add instance"
      aria-describedby={
        availability.allowed ? undefined : 'bar-add-instance-reason'
      }
      className="text-primary hover:text-primary"
    >
      <Plus aria-hidden="true" />
      <span className="hidden sm:inline">Add instance</span>
    </Button>
  )

  if (!availability.allowed) {
    // A disabled button takes no pointer events: the tooltip hangs on a
    // wrapper, and the reason is also read with the button.
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex rounded-md">
            {button}
            <span id="bar-add-instance-reason" className="sr-only">
              {availability.reason}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{availability.reason}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <NewInstanceSheet
      serviceType={serviceId}
      onCreated={(doc) => onCreated(doc.instanceId)}
      trigger={button}
    />
  )
}

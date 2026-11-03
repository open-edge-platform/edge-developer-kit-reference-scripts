// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { InstanceSwitcher } from '@/components/common/instance-switcher'
import { useSampleInstances } from '@/context/sample-instances-context'
import {
  useServiceInstances,
  useServiceStatus,
} from '@/context/service-status-context'
import { cn } from '@/lib/utils'

/**
 * Picks which instance of `serviceType` the current sample uses, or Automatic. Renders nothing
 * outside a sample page or with fewer than two instances.
 */
export function SampleInstancePicker({
  serviceType,
  label,
  className,
}: {
  serviceType: string
  label?: string
  className?: string
}) {
  const sample = useSampleInstances()
  const instances = useServiceInstances(serviceType)
  const { serviceById } = useServiceStatus()

  if (!sample || instances.length < 2) return null

  const boundKey = sample.bindings[serviceType]
  const selected = boundKey
    ? instances.find((i) => i.instanceKey === boundKey)
    : undefined
  // The type-level view is the primary instance — what Automatic resolves to.
  const primaryKey = serviceById.get(serviceType)?.instanceKey
  const resolved = instances.find((i) => i.instanceKey === primaryKey)

  const switcher = (
    <InstanceSwitcher
      selected={selected}
      instances={instances}
      onSelect={(instanceId) => {
        const instance = instances.find((i) => i.instanceId === instanceId)
        if (instance?.dbId != null) sample.bind(serviceType, instance.dbId)
      }}
      automatic={{ resolved, onSelect: () => sample.bind(serviceType, null) }}
      heading="Use in this sample"
      pending={sample.pendingType === serviceType}
      className={label ? undefined : className}
      data-testid={`sample-instance-picker-${serviceType}`}
    />
  )

  if (!label) return switcher
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <span className="text-muted-foreground text-xs">{label}</span>
      {switcher}
    </div>
  )
}

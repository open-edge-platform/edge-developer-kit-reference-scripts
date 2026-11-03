// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { PackagePlus, Wrench } from 'lucide-react'
import Link from 'next/link'
import { ServiceLink } from '@/components/common/service-link'
import { ModelDeviceBadges } from '@/components/common/model-device-badges'
import { InstanceLifecycleButton } from '@/components/services/instance-lifecycle'
import { NewInstanceSheet } from '@/components/services/new-instance-sheet'
import { Button } from '@/components/ui/button'
import { serviceHref } from '@/lib/instances/service-presentation'
import { cn } from '@/lib/utils'
import { safeHref, HREF_CHARS } from '@/lib/validation'
import {
  dependencyStatusLabel,
  type SampleDependencyView,
} from '@/samples/common/readiness'
import { ServiceConfigureDispatch } from '@/services/common/configure/service-configure-dispatch'
import { getServiceById } from '@/services/registry'
import { hasExecutionMode } from '@/services/execution'
import { dependencyStyle } from './readiness-styles'
import { SampleInstancePicker } from './sample-instance-picker'

/** The service page, on the instance this sample resolved to when the type has several. */
function dependencyHref(d: SampleDependencyView): string {
  return serviceHref(d.serviceId, {
    instanceId: d.instanceCount > 1 ? d.service?.instanceId : undefined,
  })
}

/** One dependency as a checklist row, with the one action that matches its status. */
export function SampleServiceRow({
  dependency: d,
  className,
}: {
  dependency: SampleDependencyView
  className?: string
}) {
  const style = dependencyStyle(d.status)
  const StatusIcon = style.icon
  const meta = getServiceById(d.serviceId)
  const Icon = d.service?.icon ?? meta?.icon
  const hidden = d.service?.hidden ?? meta?.hidden ?? false
  const isOptional = d.role === 'optional'
  const hasRecord = d.status !== 'missing'
  // A service that runs inside the studio (`none`) needs no instance.
  const hasInstance =
    d.service !== undefined &&
    (d.service.dbId !== undefined ||
      hasExecutionMode(d.service.execution, 'none'))

  let safeServiceHref = ''
  for (const ch of safeHref(dependencyHref(d))) {
    let ok = ''
    for (const allowed of HREF_CHARS)
      if (allowed === ch) {
        ok = allowed
        break
      }
    if (!ok) {
      safeServiceHref = '/'
      break
    }
    safeServiceHref += ok
  }

  // Laid out by the row's own width (container query), so the narrow
  // Services sheet stacks like a phone.
  return (
    <li className={cn('@container px-5 py-3', className)}>
      <div className="flex flex-col gap-3 @lg:flex-row @lg:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3 @lg:min-w-48">
          <span
            className={cn(
              'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-200',
              isOptional && 'border border-dashed',
              d.status === 'online'
                ? isOptional
                  ? 'border-info/30 bg-info/10 text-info'
                  : 'bg-primary/12 text-primary'
                : 'bg-muted text-muted-foreground',
            )}
            aria-hidden
          >
            {Icon && <Icon className="h-4 w-4" />}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {hidden || !hasRecord ? (
                <span className="text-foreground text-sm font-medium">
                  {d.name}
                </span>
              ) : (
                <Link
                  href={safeServiceHref}
                  className="text-foreground hover:text-primary text-sm font-medium underline-offset-4 transition-colors hover:underline"
                >
                  {d.name}
                </Link>
              )}
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-xs font-medium transition-colors duration-200',
                  style.text,
                )}
              >
                <StatusIcon
                  className={cn('h-3.5 w-3.5', style.spin && 'animate-spin')}
                  aria-hidden
                />
                {dependencyStatusLabel(d.status)}
              </span>
            </div>
            {(d.service?.currentModel || d.service?.currentDevice) && (
              <ModelDeviceBadges
                model={d.service.currentModel}
                device={d.service.currentDevice}
                modelMaxWidthClass="max-w-full sm:max-w-[220px]"
                className="mt-1.5"
              />
            )}
            {isOptional && d.impactText && d.status !== 'online' && (
              <p className="text-muted-foreground mt-1 text-xs">
                {d.impactText}
              </p>
            )}
            {d.status === 'error' && d.service?.statusMessage && (
              <p className="text-destructive mt-1 text-xs">
                {d.service.statusMessage}
              </p>
            )}
          </div>
        </div>

        {/* Wraps before it squeezes the name; the picker names the instance. */}
        <div className="flex min-w-0 flex-wrap items-center gap-2 pl-11 @lg:ml-auto @lg:justify-end @lg:pl-0">
          <SampleInstancePicker
            serviceType={d.serviceId}
            className="max-w-full min-w-0"
          />
          {/* Empty for a running shared service; leaves no gap then. */}
          <div className="max-w-full min-w-0 empty:hidden">
            <RowAction
              dependency={d}
              hidden={hidden}
              hasInstance={hasInstance}
            />
          </div>
          {hasInstance && (
            <div className="max-w-full min-w-0">
              <ServiceConfigureDispatch serviceId={d.serviceId} />
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

/** Set the service up, or the lifecycle control acting on the instance the sample uses. */
function RowAction({
  dependency: d,
  hidden,
  hasInstance,
}: {
  dependency: SampleDependencyView
  hidden: boolean
  hasInstance: boolean
}) {
  if (d.status !== 'missing' && !hasInstance) {
    return (
      <NewInstanceSheet
        serviceType={d.serviceId}
        trigger={
          <Button size="sm" variant="secondary" className="gap-1.5">
            <PackagePlus className="h-3.5 w-3.5" aria-hidden />
            Set up
          </Button>
        }
      />
    )
  }

  if (d.status === 'missing') {
    return (
      <Button asChild size="sm" variant="secondary" className="gap-1.5">
        <ServiceLink serviceType={d.serviceId}>
          <Wrench className="h-3.5 w-3.5" aria-hidden />
          Set up
        </ServiceLink>
      </Button>
    )
  }

  // A running shared service is stopped from its own page; a sample-owned
  // (hidden) one has no page, so it keeps its Stop here.
  if (d.status === 'online' && !hidden) return null

  // `d.key` is the bound instance, else the type (its primary instance).
  return (
    <InstanceLifecycleButton
      instance={{ instanceKey: d.key, label: d.name }}
      variant="sample"
    />
  )
}

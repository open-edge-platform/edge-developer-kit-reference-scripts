// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { ServiceLink } from '@/components/common/service-link'
import { shapedStatusDotClass } from '@/components/common/tones'
import { TruncatedText } from '@/components/common/truncated-text'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  serviceStateLabel,
  STATE_LABEL,
} from '@/lib/instances/service-presentation'
import { cn } from '@/lib/utils'
import type { Service, ServiceInstance, ServiceStatus } from '@/services/types'
import { getOSLabel, type HostOS } from '@/types/common'

/** Hollow "offline" ring colour on the sidebar surface. */
const RAIL_OFFLINE = 'border-sidebar-foreground/50'

/** A service this system cannot run: a hollow ring in the warning tone. */
const UNSUPPORTED_DOT = 'rounded-full border-2 border-warning bg-transparent'

export interface Row {
  service: Service
  instances: ServiceInstance[]
  status: ServiceStatus
  unsupported: boolean
  isCurrent: boolean
}

function NestedInstances({
  service,
  instances,
  onNavigate,
}: {
  service: Service
  instances: ServiceInstance[]
  onNavigate?: () => void
}) {
  const searchParams = useSearchParams()
  // No `?instance=` on the page means its first instance.
  const requested = searchParams.get('instance')
  const active = requested ?? instances[0]?.instanceId ?? null

  // Instances are capped per service, so all of them are listed.
  return (
    <div className="flex flex-col gap-0.5 pb-1">
      {instances.map((inst, index) => {
        const isActive = inst.instanceId === active
        return (
          <ServiceLink
            key={inst.instanceKey}
            serviceType={service.id}
            // The first instance is the page's default: its link needs no id.
            instanceId={index === 0 ? undefined : inst.instanceId}
            onClick={onNavigate}
            aria-current={isActive ? 'page' : undefined}
            // The dot's state in words; the visible text stays the name.
            aria-label={`${inst.label}, ${STATE_LABEL[inst.status]}`}
            className={cn(
              'flex min-h-9 items-center gap-2.5 rounded-lg py-1.5 pr-3 pl-10 text-[13px] transition-colors',
              isActive
                ? 'bg-sidebar-accent/40 text-sidebar-foreground font-medium'
                : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'h-1.5 w-1.5 shrink-0',
                shapedStatusDotClass(inst.status, RAIL_OFFLINE),
              )}
            />
            {/* A long name shows whole while its link is hovered or
                focused; the link's accessible name carries it too. */}
            <TruncatedText
              text={inst.label}
              focusable={false}
              className="sidebar-label"
            />
          </ServiceLink>
        )
      })}
    </div>
  )
}

/**
 * One sidebar rail entry, plus its nested instances when it is the current multi-instance service.
 * Collapsed mode shows only the icon, with a tooltip.
 */
export function ServiceRailRow({
  row,
  collapsed,
  os,
  onNavigate,
}: {
  row: Row
  collapsed: boolean
  /** Current system OS, for the "(unsupported on …)" tooltip suffix. */
  os?: HostOS
  onNavigate?: () => void
}) {
  const { service, instances, status, unsupported, isCurrent } = row
  const ServiceIcon = service.icon
  const multi = instances.length > 1
  const dotClass = unsupported
    ? UNSUPPORTED_DOT
    : shapedStatusDotClass(status, RAIL_OFFLINE)
  // The dots and count in words; the visible text stays the name (and count).
  const accessibleName = [
    service.name,
    multi && `${instances.length} instances`,
    unsupported
      ? 'unavailable on this system'
      : serviceStateLabel(service, status),
  ]
    .filter(Boolean)
    .join(', ')

  const inner = (
    <>
      <span
        className={cn(
          'shrink-0',
          collapsed ? 'relative' : 'inline-flex items-center gap-1.5',
        )}
      >
        <ServiceIcon
          aria-hidden="true"
          className={cn(
            'h-4 w-4',
            isCurrent
              ? 'text-sidebar-accent-foreground'
              : 'text-sidebar-foreground/60',
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            'h-2 w-2',
            !collapsed && 'hidden',
            collapsed && 'border-sidebar absolute -top-0.5 -right-0.5 border-2',
            dotClass,
          )}
        />
      </span>
      {collapsed ? (
        // The collapsed row's own tooltip names the service.
        <span className="sidebar-label sidebar-label-hidden truncate">
          {service.name}
        </span>
      ) : (
        <TruncatedText
          text={service.name}
          focusable={false}
          className="sidebar-label"
        />
      )}
      {multi && !collapsed && (
        <span className="bg-sidebar-foreground/10 text-sidebar-foreground/80 sidebar-label ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold">
          {instances.length}
        </span>
      )}
      <span
        aria-hidden="true"
        className={cn(
          'sidebar-label h-2 w-2 shrink-0',
          !multi && 'ml-auto',
          collapsed && 'sidebar-label-hidden',
          dotClass,
        )}
      />
    </>
  )

  const rowClass = cn(
    'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
    unsupported
      ? 'cursor-not-allowed opacity-40'
      : 'hover:bg-sidebar-accent/50',
    isCurrent
      ? 'bg-sidebar-accent/30 text-sidebar-foreground font-medium'
      : 'text-sidebar-foreground/70',
    // Hidden labels keep their flex gap; drop it or the icon sits off-centre.
    collapsed && 'justify-center gap-0 px-2',
  )

  // An unsupported service is inert, not a dimmed link that still navigates.
  const linkContent = unsupported ? (
    <span
      role="link"
      aria-disabled="true"
      aria-label={accessibleName}
      tabIndex={-1}
      className={rowClass}
    >
      {inner}
    </span>
  ) : (
    <ServiceLink
      serviceType={service.id}
      onClick={onNavigate}
      aria-current={isCurrent ? 'page' : undefined}
      aria-label={accessibleName}
      className={rowClass}
    >
      {inner}
    </ServiceLink>
  )

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {service.name}
          {multi ? ` (${instances.length} instances)` : ''}
          {unsupported && os ? ` (unsupported on ${getOSLabel(os)})` : ''}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div>
      {linkContent}
      {multi && isCurrent && (
        <Suspense fallback={null}>
          <NestedInstances
            service={service}
            instances={instances}
            onNavigate={onNavigate}
          />
        </Suspense>
      )}
    </div>
  )
}

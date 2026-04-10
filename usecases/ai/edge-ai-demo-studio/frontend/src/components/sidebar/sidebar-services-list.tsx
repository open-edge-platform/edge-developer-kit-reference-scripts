// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import Link from 'next/link'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useServiceStatus } from '@/context/service-status-context'
import { useSystemInfo } from '@/context/system-info-context'
import { cn } from '@/lib/utils'
import {
  getOSLabel,
  isServiceSupportedOnOS,
  visibleServices,
} from '@/services/registry'
import { hasExecutionMode } from '@/services/types'

function statusDotClass(status: string): string {
  switch (status) {
    case 'online':
      return 'bg-status-online'
    case 'error':
      return 'bg-status-error'
    case 'starting':
      return 'bg-warning animate-pulse'
    default:
      return 'bg-status-offline'
  }
}

export function SidebarServicesList({
  pathname,
  collapsed,
  onNavigate,
}: {
  pathname: string
  collapsed: boolean
  onNavigate?: () => void
}) {
  const { systemInfo } = useSystemInfo()
  const { statusMap } = useServiceStatus()
  return (
    <div className="pt-6">
      <div className={cn('mb-3 px-2', collapsed && 'text-center')}>
        {!collapsed && (
          <div className="flex items-center justify-between">
            <span className="text-sidebar-foreground/50 text-[11px] font-semibold tracking-wider uppercase">
              Services
            </span>
          </div>
        )}
      </div>
      <TooltipProvider>
        <div className="space-y-0.5">
          {[...visibleServices]
            .sort((a, b) => {
              const aIsNone =
                hasExecutionMode(a.execution, 'none') || a.port == null
              const bIsNone =
                hasExecutionMode(b.execution, 'none') || b.port == null
              if (aIsNone && !bIsNone) return -1
              if (!aIsNone && bIsNone) return 1
              if (aIsNone && bIsNone) return 0
              return (a.port ?? 0) - (b.port ?? 0)
            })
            .map((service) => {
              const ServiceIcon = service.icon
              const isActive = pathname === `/services/${service.id}`
              const isUnsupported = systemInfo
                ? !isServiceSupportedOnOS(service, systemInfo.os)
                : false
              const isNoneMode = hasExecutionMode(service.execution, 'none')
              const liveStatus = isNoneMode
                ? 'online'
                : (statusMap[service.id] ?? service.status)

              const linkContent = (
                <Link
                  key={service.id}
                  href={`/services/${service.id}`}
                  onClick={onNavigate}
                  className={cn(
                    'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                    isUnsupported
                      ? 'cursor-not-allowed opacity-40'
                      : 'hover:bg-sidebar-accent/50',
                    isActive
                      ? 'bg-sidebar-accent/30 text-sidebar-foreground font-medium'
                      : 'text-sidebar-foreground/70',
                    collapsed && 'justify-center px-2',
                  )}
                >
                  <span
                    className={cn(
                      'shrink-0',
                      collapsed
                        ? 'relative'
                        : 'inline-flex items-center gap-1.5',
                    )}
                  >
                    <ServiceIcon
                      className={cn(
                        'h-4 w-4',
                        isActive
                          ? 'text-sidebar-accent-foreground'
                          : 'text-sidebar-foreground/60',
                      )}
                    />
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        !collapsed && 'hidden',
                        collapsed &&
                          'border-sidebar absolute -top-0.5 -right-0.5 border-2',
                        isUnsupported
                          ? 'bg-orange-400'
                          : statusDotClass(liveStatus),
                      )}
                    />
                  </span>
                  <span
                    className={cn(
                      'sidebar-label truncate',
                      collapsed && 'sidebar-label-hidden',
                    )}
                  >
                    {service.name}
                  </span>
                  <span
                    className={cn(
                      'sidebar-label ml-auto h-2 w-2 shrink-0 rounded-full',
                      collapsed && 'sidebar-label-hidden',
                      isUnsupported
                        ? 'bg-orange-400'
                        : statusDotClass(liveStatus),
                    )}
                  />
                </Link>
              )

              if (collapsed) {
                return (
                  <Tooltip key={service.id}>
                    <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {service.name}
                      {isUnsupported && systemInfo
                        ? ` (unsupported on ${getOSLabel(systemInfo.os)})`
                        : ''}
                    </TooltipContent>
                  </Tooltip>
                )
              }

              return <span key={service.id}>{linkContent}</span>
            })}
        </div>
      </TooltipProvider>
    </div>
  )
}

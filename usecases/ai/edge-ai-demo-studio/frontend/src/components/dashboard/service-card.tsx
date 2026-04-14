// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ArrowUpRight, Ban, Cpu, Download, Monitor } from 'lucide-react'
import Link from 'next/link'
import { StatusIndicator } from '@/components/common/status-indicator'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useServiceStatus } from '@/context/service-status-context'
import { cn } from '@/lib/utils'
import { getOSLabel } from '@/services/registry'
import type { Service } from '@/services/types'
import type { OS } from '@/types/common'

interface ServiceCardProps {
  service: Service
  unsupportedOS?: boolean
  currentOS?: OS
  index?: number
}

export function ServiceCard({
  service,
  unsupportedOS,
  currentOS,
  index = 0,
}: ServiceCardProps) {
  const isUnsupported = unsupportedOS
  const { statusMap, serviceInfoMap } = useServiceStatus()
  const liveStatus = statusMap[service.id] ?? service.status
  const liveInfo = serviceInfoMap[service.id]
  const liveModel = liveInfo?.currentModel ?? service.model
  const liveDevice = liveInfo?.currentDevice ?? service.hardware

  const card = (
    <div
      className={cn(
        'glass-card group card-stagger relative flex h-full flex-col overflow-hidden rounded-xl p-5',
        isUnsupported
          ? 'cursor-not-allowed opacity-50'
          : 'card-lift cursor-pointer',
      )}
      style={{ '--card-index': index } as React.CSSProperties}
    >
      <div
        className={cn(
          'accent-line-animate absolute top-0 h-[3px] transition-colors',
          isUnsupported && 'bg-muted-foreground/10',
          !isUnsupported &&
            liveStatus === 'online' &&
            'from-primary to-secondary bg-gradient-to-r',
          !isUnsupported &&
            (liveStatus === 'offline' || liveStatus === 'starting') &&
            'bg-muted-foreground/20',
          !isUnsupported && liveStatus === 'starting' && 'animate-pulse',
          !isUnsupported && liveStatus === 'error' && 'bg-destructive/60',
        )}
      />

      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-300',
              isUnsupported
                ? 'bg-muted text-muted-foreground'
                : liveStatus === 'online'
                  ? 'from-primary/20 to-secondary/10 text-primary shadow-primary/10 group-hover:shadow-primary/15 bg-gradient-to-br shadow-sm group-hover:scale-105 group-hover:shadow-md'
                  : 'bg-muted text-muted-foreground group-hover:bg-muted/80',
            )}
          >
            <service.icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h3
                className={cn(
                  'truncate text-sm font-semibold',
                  isUnsupported
                    ? 'text-muted-foreground'
                    : 'text-foreground group-hover:text-primary-light transition-colors',
                )}
              >
                {service.name}
              </h3>
              {!isUnsupported && (
                <ArrowUpRight className="text-muted-foreground/0 group-hover:text-primary-light h-3 w-3 shrink-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              )}
            </div>
          </div>
        </div>
        {isUnsupported ? (
          <Badge
            variant="outline"
            className="shrink-0 gap-1 border-orange-400/20 bg-orange-500/10 text-[10px] text-orange-400"
          >
            <Ban className="h-2.5 w-2.5" />
            Unsupported
          </Badge>
        ) : (
          <StatusIndicator status={liveStatus} />
        )}
      </div>

      <p className="text-muted-foreground mt-3 line-clamp-2 flex-1 text-[13px] leading-relaxed">
        {service.description}
      </p>

      {isUnsupported && (
        <div className="mt-3 flex items-center gap-1.5 rounded-md border border-orange-500/10 bg-orange-500/5 px-2.5 py-1.5">
          <Monitor className="h-3 w-3 shrink-0 text-orange-400" />
          <span className="text-[11px] text-orange-400">
            {currentOS
              ? `Not available on ${getOSLabel(currentOS)}`
              : 'Not supported on this system'}
          </span>
        </div>
      )}

      {(liveModel || liveDevice) && (
        <TooltipProvider>
          <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-4">
            {liveModel && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="secondary"
                    className="bg-primary/10 text-primary border-primary/15 inline-flex max-w-[160px] items-center gap-1 text-[11px] font-medium"
                  >
                    <Download className="h-3 w-3 shrink-0" />
                    <span className="truncate">{liveModel}</span>
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom">{liveModel}</TooltipContent>
              </Tooltip>
            )}
            {liveDevice && (
              <Badge
                variant="secondary"
                className="bg-secondary/10 text-secondary border-secondary/15 inline-flex items-center gap-1 text-[11px] font-medium"
              >
                <Cpu className="h-3 w-3 shrink-0" />
                {liveDevice}
              </Badge>
            )}
          </div>
        </TooltipProvider>
      )}
    </div>
  )

  if (isUnsupported) {
    return card
  }

  return (
    <Link href={`/services/${service.id}`} className="h-full">
      {card}
    </Link>
  )
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Cpu, Download, Loader2, Power, RotateCcw, Square } from 'lucide-react'
import { StatusIndicator } from '@/components/common/status-indicator'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useServiceStatus } from '@/context/service-status-context'
import { cn } from '@/lib/utils'
import type { ServiceStatus } from '@/services/types'

interface ServiceIdentifier {
  id: string
  status: ServiceStatus
}

export function ServiceActionButton({
  service,
}: {
  service: ServiceIdentifier
}) {
  const {
    statusMap,
    startService,
    stopService,
    restartService,
    isActionPending,
    loading,
  } = useServiceStatus()

  if (loading) return <Skeleton className="h-8 w-28 rounded-md" />

  const liveStatus = statusMap[service.id] ?? service.status
  const pending = isActionPending(service.id)

  const handleClick = () => {
    if (pending) return
    if (liveStatus === 'online' || liveStatus === 'starting') {
      stopService(service.id)
    } else if (liveStatus === 'error') {
      restartService(service.id)
    } else if (liveStatus === 'offline') {
      startService(service.id)
    }
  }

  return (
    <Button
      data-testid="workload-toggle-button"
      variant={
        liveStatus === 'online' ||
        liveStatus === 'starting' ||
        liveStatus === 'error'
          ? 'destructive'
          : 'secondary'
      }
      size="sm"
      disabled={pending}
      onClick={handleClick}
      className={cn(
        'gap-2 font-medium',
        liveStatus === 'offline'
          ? 'bg-primary hover:bg-primary-light shadow-primary/20 text-white shadow-sm'
          : liveStatus === 'online' ||
              liveStatus === 'starting' ||
              liveStatus === 'error'
            ? 'bg-destructive shadow-destructive/20 text-white shadow-sm'
            : 'bg-muted text-muted-foreground hover:bg-muted/80',
      )}
    >
      {pending ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Processing...
        </>
      ) : liveStatus === 'starting' ? (
        <>
          <Square className="h-3 w-3" />
          Force Stop
        </>
      ) : liveStatus === 'online' ? (
        <>
          <Square className="h-3 w-3" />
          Stop Service
        </>
      ) : liveStatus === 'error' ? (
        <>
          <RotateCcw className="h-3.5 w-3.5" />
          Restart Service
        </>
      ) : (
        <>
          <Power className="h-3.5 w-3.5" />
          Start Service
        </>
      )}
    </Button>
  )
}

export function ServiceLiveStatus({ service }: { service: ServiceIdentifier }) {
  const { statusMap, loading } = useServiceStatus()
  if (loading) return <Skeleton className="h-6 w-16 rounded-full" />
  const liveStatus = statusMap[service.id] ?? service.status
  return (
    <div data-testid="workload-status">
      <StatusIndicator status={liveStatus} size="md" />
    </div>
  )
}

export function ServiceLiveBadges({
  service,
}: {
  service: { id: string; fallbackModel?: string; fallbackHardware?: string }
}) {
  const { serviceInfoMap } = useServiceStatus()
  const info = serviceInfoMap[service.id]
  const model = info?.currentModel ?? service.fallbackModel
  const device = info?.currentDevice ?? service.fallbackHardware

  if (!model && !device) return null

  return (
    <TooltipProvider>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {model && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="secondary"
                className="bg-primary/10 text-primary border-primary/15 inline-flex max-w-[240px] items-center gap-1 text-[11px] font-medium"
              >
                <Download className="h-3 w-3 shrink-0" />
                <span className="truncate">{model}</span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom">{model}</TooltipContent>
          </Tooltip>
        )}
        {device && (
          <Badge
            variant="secondary"
            className="bg-secondary/10 text-secondary border-secondary/15 inline-flex items-center gap-1 text-[11px] font-medium"
          >
            <Cpu className="h-3 w-3 shrink-0" />
            {device}
          </Badge>
        )}
      </div>
    </TooltipProvider>
  )
}

export function ServiceAccentBar({ service }: { service: ServiceIdentifier }) {
  const { statusMap, loading } = useServiceStatus()
  const liveStatus = loading
    ? 'offline'
    : (statusMap[service.id] ?? service.status)
  return (
    <div
      className={cn(
        'absolute inset-x-0 top-0 h-1',
        liveStatus === 'online' &&
          'from-primary via-secondary to-intel-teal bg-gradient-to-r',
        (liveStatus === 'offline' || liveStatus === 'starting') &&
          'bg-muted-foreground/20',
        liveStatus === 'starting' && 'animate-pulse',
        liveStatus === 'error' &&
          'from-destructive/80 to-destructive/40 bg-gradient-to-r',
      )}
    />
  )
}

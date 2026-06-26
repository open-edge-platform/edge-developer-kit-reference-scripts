// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AlertTriangle,
  Link2Off,
  Loader2,
  Power,
  RotateCcw,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DemoErrorBoundary } from '@/components/common/demo-error-boundary'
import {
  useGetService,
  useGetServices,
  useServiceStatus,
} from '@/context/service-status-context'
import type { Service } from '@/services/types'
import { hasExecutionMode } from '@/services/types'
import { cn } from '@/lib/utils'
import { GatedModelAlert } from './gated-model-alert'

export function ServiceDemo({ service }: { service: Service }) {
  const {
    startService,
    stopService,
    restartService,
    isActionPending,
    loading,
  } = useServiceStatus()
  const pending = isActionPending(service.id)
  const DemoComponent = service.demo

  const selectedService = useGetService(service.id)
  const prereqs = selectedService?.prerequisiteServices ?? []
  const prereqMap = useGetServices(prereqs)

  // Gated model detection — resolve the active model option from config
  const activeModelName =
    selectedService?.currentModel ?? service.defaultModel?.name ?? ''
  const activeSource = selectedService?.currentSource ?? 'huggingface'
  const activeModel = service.config?.availableModels?.find(
    (m) => m.value === activeModelName,
  )

  if (!selectedService) return null

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="border-border bg-muted/10 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center">
          <Skeleton className="mb-4 h-16 w-16 rounded-full" />
          <Skeleton className="mb-2 h-6 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="mt-6 h-10 w-36 rounded-md" />
        </div>
      </div>
    )
  }

  if (!DemoComponent) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="bg-muted/40 mb-3 flex h-12 w-12 items-center justify-center rounded-full">
          <Zap className="text-muted-foreground h-6 w-6" />
        </div>
        <p className="text-muted-foreground text-sm">
          Demo not available for this service.
        </p>
      </div>
    )
  }

  // Services with execution mode 'none' always show the demo.
  const isNoneMode = hasExecutionMode(selectedService.execution, 'none')
  const liveStatus = selectedService.status
  const isOffline = liveStatus !== 'online'

  if (isOffline && !isNoneMode) {
    const handleClick = () => {
      if (pending) return
      if (liveStatus === 'starting') {
        stopService(service.id)
      } else if (liveStatus === 'error') {
        restartService(service.id)
      } else {
        startService(service.id)
      }
    }

    return (
      <div className="space-y-6">
        <GatedModelAlert model={activeModel} source={activeSource} />
        <div className="border-border bg-muted/10 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center">
          {liveStatus === 'error' ? (
            <>
              <div className="bg-destructive/10 shadow-destructive/5 mb-4 flex h-16 w-16 items-center justify-center rounded-full shadow-sm">
                <AlertTriangle className="text-destructive h-8 w-8" />
              </div>
              <h3 className="text-foreground text-lg font-semibold">
                Service Error
              </h3>
              <p className="text-muted-foreground mt-2 max-w-md text-sm">
                This service encountered an error and is currently unavailable.
                Try restarting the service to resolve the issue.
              </p>
            </>
          ) : liveStatus === 'starting' ? (
            <>
              <div className="bg-warning/10 mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                <Loader2 className="text-warning h-8 w-8 animate-spin" />
              </div>
              <h3 className="text-foreground text-lg font-semibold">
                Service is Starting
              </h3>
              <p className="text-muted-foreground mt-2 max-w-md text-sm">
                The service is loading the model and preparing to accept
                requests. First startup may take several minutes while required
                packages are installed.
              </p>
            </>
          ) : (
            <>
              <div className="bg-muted/40 mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                <Power className="text-muted-foreground h-8 w-8" />
              </div>
              <h3 className="text-foreground text-lg font-semibold">
                Service is Offline
              </h3>
              <p className="text-muted-foreground mt-2 max-w-md text-sm">
                Start this service to access the interactive demo. The service
                will load the required model and begin accepting inference
                requests. First startup may take several minutes while required
                packages are installed.
              </p>
            </>
          )}
          {(liveStatus === 'error' || liveStatus === 'offline') && (
            <Button
              className={cn(
                'mt-6 gap-2 px-8',
                liveStatus === 'offline'
                  ? 'bg-primary hover:bg-primary-light shadow-primary/20 text-white shadow-sm'
                  : 'bg-destructive shadow-destructive/20 text-white shadow-sm',
              )}
              size="lg"
              disabled={pending}
              onClick={handleClick}
            >
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : liveStatus === 'error' ? (
                <>
                  <RotateCcw className="h-4 w-4" />
                  Restart Service
                </>
              ) : (
                <>
                  <Power className="h-4 w-4" />
                  Start Service
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    )
  }

  // ─── Prerequisite check ─────────────────────────────────────────
  const offlinePrereqs = prereqs.filter(
    (id) => (prereqMap[id]?.status ?? 'offline') !== 'online',
  )

  if (offlinePrereqs.length > 0) {
    const names = offlinePrereqs
      .map((id) => prereqMap[id]?.name ?? id)
      .join(', ')

    return (
      <div className="space-y-6">
        <div className="border-border bg-muted/10 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center">
          <div className="bg-warning/10 mb-4 flex h-16 w-16 items-center justify-center rounded-full">
            <Link2Off className="text-warning h-8 w-8" />
          </div>
          <h3 className="text-foreground text-lg font-semibold">
            Prerequisites Not Ready
          </h3>
          <p className="text-muted-foreground mt-2 max-w-md text-sm">
            This demo requires the following service(s) to be running:{' '}
            <span className="text-foreground font-medium">{names}</span>. Start
            them first, then return here.
          </p>
        </div>
      </div>
    )
  }

  // ─── Online — Specialized Demo ─────────────────────────────────
  return (
    <DemoErrorBoundary>
      <GatedModelAlert model={activeModel} source={activeSource} />
      <DemoComponent service={selectedService} />
    </DemoErrorBoundary>
  )
}

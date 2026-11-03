// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { ReactNode } from 'react'
import {
  ExternalLink,
  Loader,
  Play,
  RotateCcw,
  Square,
  TriangleAlert,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  useGetService,
  useServiceActivity,
  useServiceStatus,
} from '@/context/service-status-context'
import type { ServiceStatus } from '@/services/types'

interface SuiteLaunchPanelProps {
  serviceId: string
  suiteName: string
  launchUrl?: string
  popupHint?: string
  extraActions?: ReactNode
}

export function SuiteLaunchPanel({
  serviceId,
  suiteName,
  launchUrl,
  popupHint,
  extraActions,
}: SuiteLaunchPanelProps) {
  const service = useGetService(serviceId)
  const status = service?.status ?? 'offline'

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{suiteName}</CardTitle>
          <StatusBadge status={status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === 'online' ? (
          <ActiveBody
            serviceId={serviceId}
            suiteName={suiteName}
            launchUrl={launchUrl}
            popupHint={popupHint}
            extraActions={extraActions}
          />
        ) : (
          <InactiveBody
            serviceId={serviceId}
            suiteName={suiteName}
            status={status}
          />
        )}
      </CardContent>
    </Card>
  )
}

function StatusBadge({ status }: { status: ServiceStatus }) {
  switch (status) {
    case 'online':
      return <Badge tone="success">Active</Badge>
    case 'starting':
      return (
        <Badge tone="warning">
          <Loader className="animate-spin" aria-hidden />
          Starting…
        </Badge>
      )
    case 'error':
      return (
        <Badge tone="destructive">
          <TriangleAlert aria-hidden />
          Error
        </Badge>
      )
    case 'offline':
      return <Badge tone="muted">Offline</Badge>
  }
}

function ActiveBody({
  serviceId,
  suiteName,
  launchUrl,
  popupHint,
  extraActions,
}: {
  serviceId: string
  suiteName: string
  launchUrl?: string
  popupHint?: string
  extraActions?: ReactNode
}) {
  const { stopService } = useServiceStatus()
  const { isActionPending } = useServiceActivity()
  const pending = isActionPending(serviceId)

  const stopButton = (
    <Button
      type="button"
      variant="destructive"
      size="sm"
      disabled={pending}
      onClick={() => stopService(serviceId)}
    >
      {pending ? (
        <Loader className="mr-2 h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Square className="mr-2 h-4 w-4" aria-hidden />
      )}
      Stop {suiteName}
    </Button>
  )

  if (launchUrl) {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          {suiteName} is running. Open the suite UI in a new tab to interact
          with it.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild>
            <a href={launchUrl} target="_blank" rel="noopener noreferrer">
              Open {suiteName}
              <ExternalLink className="ml-2 h-4 w-4" aria-hidden />
            </a>
          </Button>
          <code className="bg-muted rounded px-2 py-1 text-xs">
            {launchUrl}
          </code>
          {extraActions}
          {stopButton}
        </div>
        {popupHint && (
          <p className="text-muted-foreground text-xs">{popupHint}</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        {popupHint ??
          `${suiteName} is running. It opens its own window — check your desktop or display.`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {extraActions}
        {stopButton}
      </div>
    </div>
  )
}

/** The suite is a hidden, sample-owned service with no page of its own, so it is (re)started here. */
function InactiveBody({
  serviceId,
  suiteName,
  status,
}: {
  serviceId: string
  suiteName: string
  status: Exclude<ServiceStatus, 'online'>
}) {
  const { startService, restartService } = useServiceStatus()
  const { isActionPending } = useServiceActivity()
  const pending = isActionPending(serviceId)
  const failed = status === 'error'
  const message =
    status === 'starting'
      ? `Starting up — this can take a while on first launch while Docker images are pulled.`
      : failed
        ? `The suite failed to start. Check the service logs for details.`
        : `${suiteName} is stopped. Start it to launch the suite.`

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">{message}</p>
      {status !== 'starting' && (
        <Button
          type="button"
          size="sm"
          disabled={pending}
          aria-busy={pending || undefined}
          onClick={() =>
            void (failed ? restartService(serviceId) : startService(serviceId))
          }
        >
          {pending ? (
            <Loader className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : failed ? (
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
          ) : (
            <Play className="mr-2 h-4 w-4" aria-hidden />
          )}
          {failed ? 'Retry' : 'Start'} {suiteName}
        </Button>
      )}
    </div>
  )
}

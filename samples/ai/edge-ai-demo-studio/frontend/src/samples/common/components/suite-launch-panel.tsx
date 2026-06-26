// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import {
  ExternalLink,
  Loader2,
  Settings,
  Square,
  TriangleAlert,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  useGetService,
  useServiceStatus,
} from '@/context/service-status-context'

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
          <InactiveBody serviceId={serviceId} status={status} />
        )}
      </CardContent>
    </Card>
  )
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'online':
      return (
        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
          Active
        </Badge>
      )
    case 'starting':
      return (
        <Badge variant="secondary">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          Starting…
        </Badge>
      )
    case 'error':
      return (
        <Badge variant="destructive">
          <TriangleAlert className="mr-1 h-3 w-3" />
          Error
        </Badge>
      )
    default:
      return <Badge variant="outline">Offline</Badge>
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
  const { stopService, isActionPending } = useServiceStatus()
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
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Square className="mr-2 h-4 w-4" />
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
              <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          </Button>
          <code className="bg-muted rounded px-2 py-1 text-xs">
            {launchUrl}
          </code>
          {extraActions}
          {stopButton}
        </div>
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

function InactiveBody({
  serviceId,
  status,
}: {
  serviceId: string
  status: string
}) {
  const message =
    status === 'starting'
      ? `Starting up — this can take a while on first launch while Docker images are pulled.`
      : status === 'error'
        ? `The suite failed to start. Check the service logs for details.`
        : `Start the suite from the Services page to launch it.`

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">{message}</p>
      <Button asChild variant="outline" size="sm">
        <Link href={`/services/${serviceId}`}>
          <Settings className="mr-2 h-4 w-4" />
          Open service page
        </Link>
      </Button>
    </div>
  )
}

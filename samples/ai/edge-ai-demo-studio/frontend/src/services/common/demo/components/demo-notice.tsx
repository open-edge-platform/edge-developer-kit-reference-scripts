// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AlertTriangle,
  Link2Off,
  Loader,
  Power,
  RotateCcw,
  Settings2,
} from 'lucide-react'
import { useOpenConfigure } from '@/components/configure/configure-opener'
import {
  liveStartup,
  StartupFailureDescription,
  StartupStep,
  ViewErrorsLink,
} from '@/components/services/startup-details'
import { Button } from '@/components/ui/button'
import { useServiceToggle } from '@/hooks/use-service-toggle'
import { formatElapsed } from '@/lib/browser/format'
import type { Service } from '@/services/types'
import type { DemoNoticeKind } from '../demo-notice-kind'
import { DemoStatePanel, ViewLogsButton } from './demo-state-panel'

/** After this long a start is called slow — never a promise of how long. */
const SLOW_START_MS = 3 * 60_000

/** Retry, Edit settings and View logs for a failed start. */
function FailureActions({
  serviceKey,
  onViewLogs,
}: {
  serviceKey: string
  onViewLogs?: () => void
}) {
  const { pending, run } = useServiceToggle(serviceKey)
  const openConfigure = useOpenConfigure()
  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={run}
        disabled={pending}
        data-testid="demo-retry"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Retry
      </Button>
      {openConfigure && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openConfigure}
          data-testid="demo-edit-settings"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Edit settings
        </Button>
      )}
      <ViewLogsButton onClick={onViewLogs} />
    </>
  )
}

/** The notice for the instance's state while the demo cannot take requests (see `demoNoticeKind`). */
export function DemoNotice({
  kind,
  service,
  serviceKey,
  showDemo,
  keptDemo,
  restarting,
  elapsedMs,
  prerequisiteNames,
  onViewLogs,
}: {
  kind: DemoNoticeKind
  service: Service
  serviceKey: string
  /** The demo stays on screen below the notice. */
  showDemo: boolean
  /** The demo keeps its results: hidden while starting, it comes back. */
  keptDemo: boolean
  restarting: boolean
  elapsedMs: number
  prerequisiteNames: string
  onViewLogs?: () => void
}) {
  switch (kind) {
    case 'stopping':
      return (
        <DemoStatePanel
          icon={Loader}
          iconClassName="animate-spin"
          title="Stopping service…"
          description={
            showDemo ? 'Results so far stay available here.' : undefined
          }
          testId="demo-state-stopping"
        />
      )
    case 'starting': {
      const slow = elapsedMs >= SLOW_START_MS
      return (
        <DemoStatePanel
          icon={Loader}
          iconClassName="animate-spin"
          tone="warning"
          title={restarting ? 'Restarting service…' : 'Starting service…'}
          description={
            <>
              {/* Ticks every second: hidden from screen readers, which hear
                  the state and the slow-start note, not a running clock. */}
              <span
                aria-hidden="true"
                className="text-foreground font-medium tabular-nums"
                data-testid="demo-starting-elapsed"
              >
                {formatElapsed(elapsedMs)} elapsed
              </span>
              {' · '}
              {slow
                ? 'This is taking a while. Large models take time to download; the logs show what it is doing.'
                : keptDemo
                  ? 'The demo and your results come back once it is running.'
                  : 'A first start downloads the model and its runtime, which can take several minutes.'}
              {/* The step the start reported, if any (never a guess). */}
              <StartupStep startup={liveStartup(service)} />
            </>
          }
          testId="demo-state-starting"
        >
          <ViewLogsButton onClick={onViewLogs} />
        </DemoStatePanel>
      )
    }
    case 'error':
      return (
        <DemoStatePanel
          icon={AlertTriangle}
          tone="destructive"
          title="Failed to start"
          description={
            <StartupFailureDescription
              statusMessage={service.statusMessage}
              startup={service.startup}
              fallback="It stopped before it became ready. The logs show what happened."
            />
          }
          testId="demo-state-error"
        >
          <FailureActions serviceKey={serviceKey} onViewLogs={onViewLogs} />
          <ViewErrorsLink service={service} />
        </DemoStatePanel>
      )
    case 'stopped':
      return (
        <DemoStatePanel
          icon={Power}
          title="Stopped"
          description={
            showDemo
              ? 'Start the service to send new requests. Results so far stay available.'
              : 'Start the service to use the demo.'
          }
          testId="demo-state-offline"
        />
      )
    case 'prerequisites':
      return (
        <DemoStatePanel
          icon={Link2Off}
          tone="warning"
          title="Waiting for other services"
          description={
            <>
              This demo also needs{' '}
              <span className="text-foreground font-medium">
                {prerequisiteNames}
              </span>{' '}
              running.
            </>
          }
          testId="demo-state-prerequisites"
        />
      )
    default:
      return null
  }
}

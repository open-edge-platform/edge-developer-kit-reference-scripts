// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { PackagePlus, WifiOff, Zap } from 'lucide-react'
import { DemoErrorBoundary } from '@/components/common/demo-error-boundary'
import { EmptyState } from '@/components/common/empty-state'
import {
  useGetService,
  useGetServices,
  useServiceActivity,
  useServiceStatus,
} from '@/context/service-status-context'
import { hasExecutionMode } from '@/services/execution'
import { getEffectiveModel } from '@/types/service'
import type { Service } from '@/services/types'
import { DemoRuntimeProvider } from '../demo-runtime'
import { demoNoticeKind } from '../demo-notice-kind'
import { demoStateKey } from '../demo-session'
import { useSessionState } from '../session-store'
import { useStartWatch } from '../use-start-watch'
import { DemoMetricsPanel } from './demo-metrics-panel'
import { DemoNotice } from './demo-notice'
import { DemoShellSkeleton } from './demo-shell-skeleton'
import { DemoStatePanel } from './demo-state-panel'
import { GatedModelAlert } from './gated-model-alert'
import { ReadyNotice } from './ready-notice'

export function ServiceDemo({
  service,
  onViewLogs,
}: {
  service: Service
  /** Switches the page to this instance's logs. */
  onViewLogs?: () => void
}) {
  const { loading, connectionError, serviceById } = useServiceStatus()
  const { getPendingAction } = useServiceActivity()
  // `service` may be one instance of a multi-instance service; act on it.
  const serviceKey = service.instanceKey ?? service.id
  const DemoComponent = service.demo

  const selectedService = useGetService(serviceKey)
  const prereqs = selectedService?.prerequisiteServices ?? []
  const prereqMap = useGetServices(prereqs)
  // Whether the demo was usable this visit: a demo that keeps its results then stays shown when
  // its instance is stopped or failed.
  const [opened, setOpened] = useSessionState(
    demoStateKey(service, 'demo-opened'),
    false,
  )

  // The active model option, for the gated-model alert.
  const activeModelName = getEffectiveModel(selectedService ?? service).name
  const activeSource = selectedService?.currentSource ?? 'huggingface'
  const activeModel = service.config?.availableModels?.find(
    (m) => m.value === activeModelName,
  )

  // Services with execution mode 'none' always show the demo.
  const isNoneMode = selectedService
    ? hasExecutionMode(selectedService.execution, 'none')
    : false
  const liveStatus = selectedService?.status
  const isOffline = liveStatus !== 'online' && !isNoneMode
  const offlinePrereqs = prereqs.filter(
    (id) => (prereqMap[id]?.status ?? 'offline') !== 'online',
  )
  const pendingAction = getPendingAction(serviceKey)
  const leaving = pendingAction === 'stop' || pendingAction === 'restart'
  const runnable =
    Boolean(selectedService) &&
    !loading &&
    !isOffline &&
    offlinePrereqs.length === 0
  if (runnable && !opened) setOpened(true)

  const starting =
    liveStatus === 'starting' ||
    pendingAction === 'start' ||
    pendingAction === 'restart'
  const { elapsedMs, readyNotice, dismissReadyNotice } = useStartWatch({
    starting,
    startingSince: selectedService?.startingSince,
    liveStatus,
    metricsBase: selectedService?.apiBase,
  })

  if (!selectedService) return null

  if (loading) return <DemoShellSkeleton />

  if (!DemoComponent) {
    return (
      <EmptyState
        icon={Zap}
        size="sm"
        description="Demo not available for this service."
      />
    )
  }

  // A multi-instance service that was never added has no instance to start;
  // the control bar's Add instance is the way in.
  const typeView = serviceById.get(service.id)
  if (isOffline && typeView?.multiInstance && !typeView.added) {
    return (
      <DemoStatePanel
        icon={PackagePlus}
        title="No instance"
        description={`Add an instance of ${typeView.name} to use the demo.`}
      />
    )
  }

  // While the instance starts, the notice replaces every demo so all viewers see the same state.
  // A demo that keeps its results stays mounted under a notice while stopping, stopped or failed;
  // any other is replaced (releasing a camera or microphone).
  const keep = Boolean(selectedService.keepDemoWhenStopped)
  const keptDemo = keep && opened
  const showDemo = !starting && (runnable || keptDemo)
  const available = runnable && !leaving
  const noticeKind = demoNoticeKind({
    isOffline,
    stoppingKeptDemo: keptDemo && showDemo && pendingAction === 'stop',
    pendingAction,
    starting,
    liveStatus,
    waitingForPrerequisites: offlinePrereqs.length > 0,
  })

  // One shape for every state, so a kept demo is not remounted as notices come and go. Metrics sit
  // outside the error boundary so a crashed demo still shows them; mode `none` has no worker.
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {connectionError && (
          <DemoStatePanel
            icon={WifiOff}
            tone="warning"
            title="Status unavailable"
            description="The studio cannot reach its service list right now, so this shows the last known state until it reconnects."
            testId="demo-state-disconnected"
          />
        )}
        {readyNotice && runnable && !connectionError && (
          <ReadyNotice
            service={selectedService}
            onDismiss={dismissReadyNotice}
          />
        )}
        <DemoNotice
          kind={noticeKind}
          service={selectedService}
          serviceKey={serviceKey}
          showDemo={showDemo}
          keptDemo={keptDemo}
          restarting={pendingAction === 'restart'}
          elapsedMs={elapsedMs}
          prerequisiteNames={offlinePrereqs
            .map((id) => prereqMap[id]?.name ?? id)
            .join(', ')}
          onViewLogs={onViewLogs}
        />
        <GatedModelAlert
          model={activeModel}
          source={activeSource}
          serviceId={selectedService.dbId}
        />
        {showDemo && (
          <DemoErrorBoundary>
            <DemoRuntimeProvider value={{ available }}>
              <DemoComponent service={selectedService} />
            </DemoRuntimeProvider>
          </DemoErrorBoundary>
        )}
      </div>
      {runnable && !isNoneMode && (
        <DemoMetricsPanel service={selectedService} onViewLogs={onViewLogs} />
      )}
    </div>
  )
}

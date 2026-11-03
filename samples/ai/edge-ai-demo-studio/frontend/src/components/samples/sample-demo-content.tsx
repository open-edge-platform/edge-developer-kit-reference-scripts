// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ArrowLeft, ScrollText, Server, Settings } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SampleInstancesProvider } from '@/context/sample-instances-context'
import { cn } from '@/lib/utils'
import { SampleParamsSlotContext } from '@/samples/common/sample-params-slot'
import { SampleWorkspaceProvider } from '@/samples/common/sample-workspace'
import type { SampleReadinessView } from '@/samples/common/readiness'
import { getSampleById } from '@/samples/registry'
import { hasRecommendedConfig, type Sample } from '@/samples/types'
import { DemoWorkspaceSkeleton } from './demo-workspace-skeleton'
import { ReadinessSummary } from './readiness-summary'
import { readinessStyle } from './readiness-styles'
import { RecommendedConfigDialog } from './recommended-config-dialog'
import { SampleCompatibilityNotice } from './sample-compatibility-notice'
import { SampleLogDrawer } from './sample-log-drawer'
import { SampleServicesSheet } from './sample-services-sheet'
import { SampleSetupPanel } from './sample-setup-panel'
import { SampleDemo } from './sample-demo'
import { StartAllServicesButton } from './start-all-services-button'
import { useSampleServices } from './hooks/use-sample-services'

export function SampleDemoContent({ sampleId }: { sampleId: string }) {
  // The page checked the id already; the registry is the same on both sides.
  const sample = getSampleById(sampleId)
  if (!sample) notFound()
  return (
    <SampleInstancesProvider sampleId={sample.id}>
      <SampleDemoContentInner sample={sample} />
    </SampleInstancesProvider>
  )
}

function SampleDemoContentInner({ sample }: { sample: Sample }) {
  const { view, allServices, retry, retrying } = useSampleServices(sample)

  const [paramsSlot, setParamsSlot] = useState<HTMLDivElement | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)
  const [servicesOpen, setServicesOpen] = useState(false)
  const [recommendedOpen, setRecommendedOpen] = useState(false)
  const servicesTriggerRef = useRef<HTMLButtonElement>(null)

  // Once mounted the workspace stays mounted, so a service dropping out
  // later does not throw away drafts and results.
  const [everReady, setEverReady] = useState(false)
  if (view.canLaunch && !everReady) setEverReady(true)
  const workspaceMounted = everReady
  // Also pause while readiness is unsettled: no new requests to a target
  // that cannot be confirmed.
  const suspended =
    workspaceMounted && (!view.allRequiredOnline || !view.settled)
  const offlineRequired = view.required
    .filter((d) => d.status !== 'online')
    .map((d) => d.name)

  const hasError = view.failed.length > 0
  const hasStarting = view.starting.length > 0

  if (view.state === 'unsupported' && view.compatibility) {
    return (
      <SampleCompatibilityNotice
        sample={sample}
        compatibility={view.compatibility}
        variant="panel"
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* One toolbar row: a short viewport needs every pixel above the workspace. */}
      <div className="surface-panel flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-4 py-2.5">
        <Button asChild variant="ghost" size="icon-sm" className="shrink-0">
          <Link
            href={`/samples/${sample.id}`}
            aria-label={`Back to ${sample.title}`}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
        <h1 className="text-foreground min-w-0 truncate text-base leading-tight font-semibold">
          {sample.title}
        </h1>
        <ReadinessSummary view={view} variant="pill" />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            ref={servicesTriggerRef}
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setServicesOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={servicesOpen}
            data-testid="sample-services-trigger"
          >
            <Server className="h-3.5 w-3.5" aria-hidden />
            Services
          </Button>
          {/* The demo portals its Parameters sheet trigger here. */}
          <div ref={setParamsSlot} className="contents" />
          <Button
            data-testid="log-drawer-toggle"
            variant="outline"
            size="sm"
            className={cn(
              'relative gap-1.5 text-xs',
              logsOpen && 'bg-accent text-accent-foreground',
            )}
            onClick={() => setLogsOpen((v) => !v)}
            aria-expanded={logsOpen}
            aria-controls="sample-log-drawer"
          >
            <ScrollText className="h-3.5 w-3.5" aria-hidden />
            Logs
            {(hasError || hasStarting) && (
              <>
                <span
                  className={cn(
                    'ring-background absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full ring-2',
                    hasError ? 'bg-destructive' : 'bg-warning animate-pulse',
                  )}
                  aria-hidden
                />
                <span className="sr-only">
                  {hasError ? ' (a service failed)' : ' (services starting)'}
                </span>
              </>
            )}
          </Button>
        </div>
      </div>

      {logsOpen && (
        <SampleLogDrawer
          services={allServices}
          onClose={() => setLogsOpen(false)}
        />
      )}

      {workspaceMounted && view.state !== 'ready' && (
        <WorkspaceStatusBanner
          view={view}
          suspended={suspended}
          offlineRequired={offlineRequired}
          offerLogs={(hasError || hasStarting) && !logsOpen}
          onViewLogs={() => setLogsOpen(true)}
          onOpenServices={() => setServicesOpen(true)}
        />
      )}

      {workspaceMounted ? (
        <SampleWorkspaceProvider
          value={{ suspended, offlineRequired, readiness: view }}
        >
          <SampleParamsSlotContext.Provider value={paramsSlot}>
            <div aria-busy={suspended || undefined}>
              <SampleDemo sample={sample} />
            </div>
          </SampleParamsSlotContext.Provider>
        </SampleWorkspaceProvider>
      ) : view.state === 'checking' ? (
        <DemoWorkspaceSkeleton />
      ) : (
        <SampleSetupPanel
          sample={sample}
          view={view}
          onUseRecommendedConfig={() => setRecommendedOpen(true)}
          onViewLogs={() => setLogsOpen(true)}
          onRetry={retry}
          retrying={retrying}
          collapseSignal={0}
        />
      )}

      <SampleServicesSheet
        sample={sample}
        view={view}
        open={servicesOpen}
        onOpenChange={setServicesOpen}
        fallbackFocus={servicesTriggerRef}
      />
      {hasRecommendedConfig(sample) && (
        <RecommendedConfigDialog
          sample={sample}
          open={recommendedOpen}
          onOpenChange={setRecommendedOpen}
        />
      )}
    </div>
  )
}

/** Shown above a mounted workspace whose readiness dropped: what changed and the way back. */
function WorkspaceStatusBanner({
  view,
  suspended,
  offlineRequired,
  offerLogs,
  onViewLogs,
  onOpenServices,
}: {
  view: SampleReadinessView
  /** New requests are paused (see SampleWorkspaceProvider). */
  suspended: boolean
  offlineRequired: string[]
  offerLogs: boolean
  onViewLogs: () => void
  onOpenServices: () => void
}) {
  const style = readinessStyle(view.state)
  const StateIcon = style.icon
  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3',
        style.surface,
      )}
    >
      <StateIcon
        className={cn(
          'h-5 w-5 shrink-0',
          style.text,
          style.spin && 'animate-spin',
        )}
        aria-hidden
      />
      <div className="min-w-48 flex-1">
        <p className={cn('text-sm font-semibold', style.strongText)}>
          {view.label}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {suspended && view.state === 'unavailable'
            ? view.detail
            : suspended
              ? `Your work is kept. Actions that need ${offlineRequired.join(', ')} are paused until ${offlineRequired.length === 1 ? 'it is' : 'they are'} back.`
              : (view.detail ?? 'Your work is kept while status is rechecked.')}
        </p>
        {view.failed.map(
          (d) =>
            d.service?.statusMessage && (
              <p key={d.serviceId} className="text-destructive mt-1 text-xs">
                {d.name}: {d.service.statusMessage}
              </p>
            ),
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {view.settled && !view.allRequiredOnline && (
          <StartAllServicesButton dependencies={view.required} />
        )}
        {offerLogs && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={onViewLogs}
          >
            <ScrollText className="h-3.5 w-3.5" aria-hidden />
            View logs
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={onOpenServices}
        >
          <Settings className="h-3.5 w-3.5" aria-hidden />
          Services
        </Button>
      </div>
    </div>
  )
}

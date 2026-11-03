// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { FileText, Play, Rocket, Terminal } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConfigureOpenerProvider } from '@/components/configure/configure-opener'
import { EmptyState } from '@/components/common/empty-state'
import { ShareSessionBusy } from '@/components/services/instance-lifecycle'
import { ServiceSetupOverview } from '@/components/services/service-setup-overview'
import { Skeleton } from '@/components/ui/skeleton'
import { hasExecutionMode } from '@/services/execution'
import { useGetService } from '@/context/service-status-context'
import { useUrlSearchState } from '@/hooks/use-url-search-state'
import type { InstanceTab } from '@/lib/instances/service-presentation'
import { cn } from '@/lib/utils'
import type { ServiceInstance } from '@/services/types'
import { docsRegistry } from '@/services/_generated/docs'
import { ServiceDemo } from '@/services/common/demo/components/service-demo'
import { DemoSessionProvider } from '@/services/common/demo/session-store'
import { ServiceDocs } from '@/services/common/documentation/components/doc'
import { ServiceLogs } from '@/services/common/logs/components/log'
import { getServiceModelName } from '@/services/common/get-service-model'
import { ServiceControlBar } from './service-control-bar'
import type { ServiceTab } from './use-selected-instance'

const emptySubscribe = () => () => {}

/**
 * Publishes the sticky region's coverage as `--service-sticky-offset` (top + height while sticky,
 * top only once it scrolls away) so docs anchors land below it, and the controls' height as
 * `--service-controls-height` for the narrow-screen top that tucks them under the page header.
 */
function trackStickyOffset(bar: HTMLDivElement | null) {
  const host = bar?.parentElement
  if (!bar || !host) return
  const update = () => {
    const controls = bar.querySelector<HTMLElement>('[data-service-controls]')
    bar.style.setProperty(
      '--service-controls-height',
      `${controls?.offsetHeight ?? 0}px`,
    )
    const style = getComputedStyle(bar)
    const top = parseFloat(style.top) || 0
    const offset = style.position === 'sticky' ? top + bar.offsetHeight : top
    host.style.setProperty('--service-sticky-offset', `${offset}px`)
  }
  update()
  const observer = new ResizeObserver(update)
  observer.observe(bar)
  const classes = new MutationObserver(update)
  classes.observe(bar, { attributes: true, attributeFilter: ['class'] })
  window.addEventListener('resize', update)
  return () => {
    observer.disconnect()
    classes.disconnect()
    window.removeEventListener('resize', update)
    host.style.removeProperty('--service-sticky-offset')
  }
}

const TAB_TRIGGER_CLASS =
  'h-9 gap-2 rounded-md px-3 text-xs font-medium transition-colors duration-150 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground sm:px-4 sm:text-sm'

const SERVICE_TABS: readonly ServiceTab[] = ['overview', 'demo', 'docs', 'logs']

function toServiceTab(value: string): ServiceTab | undefined {
  return SERVICE_TABS.find((tab) => tab === value)
}

export function ServiceDetailTabs({
  serviceId,
  selected,
  instances,
  onSelect,
  requestedTab,
  onTabChange,
  loading,
  instanceAvailable = true,
}: {
  serviceId: string
  /** Instance to show; the type's primary instance when omitted. */
  selected?: ServiceInstance
  instances: ServiceInstance[]
  onSelect: (instanceId: string, tab?: InstanceTab) => void
  /** `?tab` as the address gives it. */
  requestedTab: string | null
  onTabChange: (tab: ServiceTab) => void
  /** Instances are still loading: the bar holds placeholders. */
  loading: boolean
  instanceAvailable?: boolean
}) {
  // Not added yet: the setup overview leads, unless the documentation was
  // asked for by name. Demo and Logs wait for an instance.
  const notAdded = !instanceAvailable && !loading
  const tab: ServiceTab = notAdded
    ? requestedTab === 'docs'
      ? 'docs'
      : 'overview'
    : requestedTab === 'docs' || requestedTab === 'logs'
      ? requestedTab
      : 'demo'
  // On Documentation on a narrow screen (any tab on a phone) the instance controls slide under
  // the page header; focus in the controls brings them back until it moves into the tab.
  const [revealControls, setRevealControls] = useState(false)
  const compactDocs = tab === 'docs' && !revealControls
  const compactPhone = tab !== 'docs' && !revealControls
  // Tabs report a plain string; only a tab this page has is written.
  const setTab = (next: string) => {
    const parsed = toServiceTab(next)
    if (!parsed) return
    setRevealControls(false)
    onTabChange(parsed)
  }

  // Log filters live in the address (`?level=`, `?source=`) so a link can open Logs filtered;
  // they belong to one instance, so switching clears them.
  const [searchParams, writeSearchParams] = useUrlSearchState()
  const logFilterAddress = {
    level: searchParams.get('level'),
    source: searchParams.get('source'),
    write: writeSearchParams,
  }
  const selectInstance = (instanceId: string, nextTab?: InstanceTab) => {
    if (instanceId !== selected?.instanceId) {
      writeSearchParams({ level: null, source: null })
    }
    onSelect(instanceId, nextTab)
  }
  // An instance key resolves to that instance's view; the type resolves to
  // the primary instance's view — both carry status, model, logs and apiBase.
  const service = useGetService(selected?.instanceKey ?? serviceId)

  const origin = useSyncExternalStore(
    emptySubscribe,
    () => window.location.origin,
    () => '',
  )

  const docs =
    service && origin
      ? (docsRegistry[service.id]?.({
          // A service with no instance row (MCP Manager) has no address.
          host: `${origin}${service.apiBase ?? (hasExecutionMode(service.execution, 'none') ? '' : `/api/${service.id}@<instance-id>`)}`,
          model: getServiceModelName(service, true),
          // Live worker port (only while running) for docs that describe
          // endpoints which bypass the proxy, such as WebSockets.
          port: service.instancePort,
          // What picks the backend (e.g. `sttBackend`): as the running
          // process was started, else as saved. None without an instance.
          metadata: service.instanceKey
            ? (service.applied?.metadata ?? service.metadata ?? {})
            : undefined,
        }) ?? null)
      : null

  if (!service) return null

  const isNoneMode = hasExecutionMode(service.execution, 'none')
  const hasLogs = service.logSources.length > 0
  const logsReady = instanceAvailable && !loading && hasLogs
  const DemoIcon = service.demoTab?.icon ?? Play

  return (
    <DemoSessionProvider>
      <ShareSessionBusy />
      <ConfigureOpenerProvider>
        <Tabs
          value={tab === 'logs' && !hasLogs ? 'demo' : tab}
          onValueChange={setTab}
          className="w-full min-w-0 gap-4"
        >
          {/* One sticky region for the instance and its tabs; on a short viewport it scrolls
            away to leave room for the demo. */}
          <div
            ref={trackStickyOffset}
            className={cn(
              'service-tabs-bar border-primary/20 bg-card/95 shadow-primary/5 sticky top-30 z-20 rounded-xl border shadow-md backdrop-blur-xl lg:top-16 [@media(max-height:560px)]:static',
              compactDocs &&
                'max-lg:top-[calc(7.5rem-var(--service-controls-height,0px))]',
              compactPhone &&
                'max-sm:top-[calc(7.5rem-var(--service-controls-height,0px))]',
            )}
          >
            {!isNoneMode && (
              <div
                data-service-controls
                className="border-primary/15 border-b"
                onFocus={() => setRevealControls(true)}
              >
                <ServiceControlBar
                  serviceId={serviceId}
                  loading={loading}
                  selected={selected}
                  instances={instances}
                  onSelect={selectInstance}
                />
              </div>
            )}
            {notAdded && (
              <p id="service-tabs-unavailable" className="sr-only">
                Demo and Logs become available once the service is added.
              </p>
            )}
            <TabsList
              aria-label="Service views"
              className="max-w-full flex-wrap justify-start gap-1 bg-transparent p-2 group-data-[orientation=horizontal]/tabs:h-auto"
            >
              {notAdded && (
                <TabsTrigger
                  value="overview"
                  className={TAB_TRIGGER_CLASS}
                  data-testid="service-tab-overview"
                >
                  <Rocket className="h-3.5 w-3.5" />
                  Overview
                </TabsTrigger>
              )}
              <TabsTrigger
                disabled={!instanceAvailable}
                value="demo"
                className={TAB_TRIGGER_CLASS}
                title={
                  notAdded ? 'Available once the service is added' : undefined
                }
                aria-describedby={
                  notAdded ? 'service-tabs-unavailable' : undefined
                }
                data-testid="service-tab-demo"
              >
                <DemoIcon className="h-3.5 w-3.5" />
                {service.demoTab?.label ?? 'Demo'}
              </TabsTrigger>
              <TabsTrigger
                value="docs"
                className={TAB_TRIGGER_CLASS}
                data-testid="service-tab-docs"
              >
                <FileText className="h-3.5 w-3.5" />
                Documentation
              </TabsTrigger>
              {hasLogs && (
                <TabsTrigger
                  disabled={!logsReady}
                  value="logs"
                  className={TAB_TRIGGER_CLASS}
                  title={
                    notAdded ? 'Available once the service is added' : undefined
                  }
                  aria-describedby={
                    notAdded ? 'service-tabs-unavailable' : undefined
                  }
                  data-testid="service-tab-logs"
                >
                  <Terminal className="h-3.5 w-3.5" />
                  Logs
                </TabsTrigger>
              )}
            </TabsList>
          </div>

          {notAdded && (
            <TabsContent value="overview" className="min-w-0">
              <ServiceSetupOverview
                service={service}
                onShowDocs={() => onTabChange('docs')}
                onAdded={(doc) => selectInstance(doc.instanceId, 'demo')}
              />
            </TabsContent>
          )}

          {/* Keyed by instance so a switch remounts the demo; what a demo
            keeps per instance lives in the DemoSessionProvider above. */}
          <TabsContent
            key={`demo-${service.instanceKey ?? service.id}`}
            value="demo"
            forceMount
            className="min-w-0 data-[state=inactive]:hidden"
            onFocus={() => setRevealControls(false)}
          >
            {instanceAvailable && (
              <ServiceDemo
                service={service}
                onViewLogs={() => onTabChange('logs')}
              />
            )}
          </TabsContent>

          <TabsContent
            value="docs"
            className="min-w-0 data-[state=inactive]:hidden"
            onFocus={() => setRevealControls(false)}
          >
            {docs ? (
              <ServiceDocs
                service={service}
                docs={docs}
                baseUrl={
                  service.apiBase
                    ? `${origin}${service.apiBase}`
                    : isNoneMode
                      ? origin
                      : undefined
                }
              />
            ) : !origin ? (
              <Skeleton className="h-64 w-full rounded-xl" />
            ) : (
              <EmptyState icon={FileText} title="Documentation not available" />
            )}
          </TabsContent>
          {logsReady && (
            <TabsContent
              key={`logs-${service.instanceKey ?? service.id}`}
              value="logs"
              forceMount
              className="min-w-0 data-[state=inactive]:hidden"
              onFocus={() => setRevealControls(false)}
            >
              <ServiceLogs service={service} filterAddress={logFilterAddress} />
            </TabsContent>
          )}
        </Tabs>
      </ConfigureOpenerProvider>
    </DemoSessionProvider>
  )
}

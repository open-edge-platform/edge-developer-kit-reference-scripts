// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { SampleInstancesProvider } from '@/context/sample-instances-context'
import { useUrlSearchState } from '@/hooks/use-url-search-state'
import { hasRecommendedConfig, type Sample } from '@/samples/types'
import { GatedModelAlert } from '@/services/common/demo/components/gated-model-alert'
import type { Service } from '@/services/types'
import { getEffectiveModel } from '@/types/service'
import { ExportBundleDialog } from './export-bundle-dialog'
import { useSampleServices } from './hooks/use-sample-services'
import { RecommendedConfigDialog } from './recommended-config-dialog'
import { SampleCompatibilityNotice } from './sample-compatibility-notice'
import { SampleHeader } from './sample-header'
import {
  parseSampleReadingTab,
  type SampleDocs,
  type SampleReadingTab,
  SampleReadingTabs,
} from './sample-reading-tabs'
import { SampleSetupPanel } from './sample-setup-panel'

export function SampleDetailContent({
  sample,
  docs,
}: {
  sample: Sample
  docs?: SampleDocs
}) {
  // The reading tabs read the URL, so the client part sits behind Suspense
  // and the rest of the route can still prerender.
  return (
    <SampleInstancesProvider sampleId={sample.id}>
      <Suspense fallback={<SampleDetailSkeleton />}>
        <SampleDetailContentInner sample={sample} docs={docs} />
      </Suspense>
    </SampleInstancesProvider>
  )
}

function revealPanel(panel: HTMLElement | null) {
  panel?.focus({ preventScroll: false })
  panel?.scrollIntoView({ block: 'start' })
}

function SampleDetailSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-6">
      <span className="sr-only">Loading sample…</span>
      <div aria-hidden="true" className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <Skeleton aria-hidden="true" className="h-24 w-full rounded-xl" />
      <Skeleton aria-hidden="true" className="h-80 w-full rounded-xl" />
    </div>
  )
}

function SampleDetailContentInner({
  sample,
  docs,
}: {
  sample: Sample
  docs?: SampleDocs
}) {
  const [exportOpen, setExportOpen] = useState(false)
  const [recommendedOpen, setRecommendedOpen] = useState(false)
  // Bumped on leaving Overview, so the setup checklist folds back without an effect.
  const [collapseSignal, setCollapseSignal] = useState(0)
  const [logService, setLogService] = useState<string | undefined>(undefined)
  const logsPanelRef = useRef<HTMLDivElement>(null)
  // "View logs" asked for the logs panel; it takes focus once it shows.
  const focusLogsRef = useRef(false)

  // The URL owns the reading tab; switching never adds a history entry.
  const [searchParams, setSearchParams] = useUrlSearchState()
  const tab = parseSampleReadingTab(searchParams.get('tab'))

  const { view, allServices, retry, retrying } = useSampleServices(sample)

  const selectTab = (next: SampleReadingTab) => {
    setSearchParams(
      { tab: next === 'overview' ? null : next },
      { clearHash: true },
    )
    if (next !== 'overview') setCollapseSignal((n) => n + 1)
  }

  // Once the Logs tab shows, focus its panel and bring it into view.
  useEffect(() => {
    if (tab !== 'logs' || !focusLogsRef.current) return
    focusLogsRef.current = false
    revealPanel(logsPanelRef.current)
  }, [tab])

  const viewLogs = (serviceId?: string) => {
    if (serviceId) setLogService(serviceId)
    if (tab === 'logs') {
      revealPanel(logsPanelRef.current)
      return
    }
    focusLogsRef.current = true
    selectTab('logs')
  }

  return (
    <div className="space-y-6">
      <SampleHeader sample={sample} onExport={() => setExportOpen(true)} />

      {view.compatibility && !view.compatibility.supported && (
        <SampleCompatibilityNotice
          sample={sample}
          compatibility={view.compatibility}
        />
      )}

      <GatedModelAlerts services={allServices} />

      <SampleSetupPanel
        sample={sample}
        view={view}
        onUseRecommendedConfig={() => setRecommendedOpen(true)}
        onViewLogs={viewLogs}
        onRetry={retry}
        retrying={retrying}
        collapseSignal={collapseSignal}
      />

      <SampleReadingTabs
        sample={sample}
        docs={docs}
        allServices={allServices}
        tab={tab}
        onTabChange={selectTab}
        logService={logService}
        onLogServiceChange={setLogService}
        logsPanelRef={logsPanelRef}
      />

      <ExportBundleDialog
        sampleIds={[sample.id]}
        open={exportOpen}
        onOpenChange={setExportOpen}
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

/** A gated-model notice for every dependency whose active model needs access. */
function GatedModelAlerts({ services }: { services: Service[] }) {
  if (!services.some((s) => s.config?.availableModels?.length)) return null
  return (
    <div className="space-y-4">
      {services.map((s) => {
        const { name, source = 'huggingface' } = getEffectiveModel(s)
        return (
          <GatedModelAlert
            key={s.instanceKey ?? s.id}
            model={s.config?.availableModels?.find((m) => m.value === name)}
            source={source}
            serviceId={s.dbId}
          />
        )
      })}
    </div>
  )
}

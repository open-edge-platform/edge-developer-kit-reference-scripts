// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { BookText, RotateCcw, ScrollText, Workflow } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type RefObject, useState } from 'react'
import { Streamdown } from 'streamdown'
import { EmptyState } from '@/components/common/empty-state'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getCategoryLabels, type Sample } from '@/samples/types'
import type { Service } from '@/services/types'
import { SamplePreviewImage } from './sample-preview-image'
import { ServiceLogTabs } from './service-log-tabs'

/** `unavailable`: declared but unreadable. A sample with no guide gets `undefined` and no tab. */
export type SampleDocs =
  { status: 'ok'; markdown: string } | { status: 'unavailable' }

export type SampleReadingTab = 'overview' | 'docs' | 'logs'

/** Anything the URL cannot name reads as Overview. */
export function parseSampleReadingTab(value: string | null): SampleReadingTab {
  return value === 'docs' || value === 'logs' ? value : 'overview'
}

interface SampleReadingTabsProps {
  sample: Sample
  docs?: SampleDocs
  allServices: Service[]
  tab: SampleReadingTab
  onTabChange: (tab: SampleReadingTab) => void
  /** Selected log service (`Service.id`); kept by the page across tab switches. */
  logService?: string
  onLogServiceChange: (serviceId: string) => void
  /** The Logs panel, so "View logs" on a failure can focus and scroll to it. */
  logsPanelRef: RefObject<HTMLDivElement | null>
}

/**
 * Overview, Documentation and Logs tabs of a sample page. Logs mount lazily, then stay mounted so
 * their entries, filters and scroll position survive switching tabs.
 */
export function SampleReadingTabs({
  sample,
  docs,
  allServices,
  tab,
  onTabChange,
  logService,
  onLogServiceChange,
  logsPanelRef,
}: SampleReadingTabsProps) {
  const router = useRouter()
  const logServices = allServices.filter((s) => s.logSources.length > 0)
  const labels = Array.from(
    new Set([...getCategoryLabels(sample), ...sample.tags]),
  )

  // `?tab=docs` on a sample with no guide reads as Overview.
  const active: SampleReadingTab = tab === 'docs' && !docs ? 'overview' : tab

  // Expensive log queries stay inactive until the reader asks for them once.
  const [logsVisited, setLogsVisited] = useState(active === 'logs')
  if (active === 'logs' && !logsVisited) setLogsVisited(true)

  const activeLogService =
    logService && logServices.some((s) => s.id === logService)
      ? logService
      : logServices[0]?.id

  return (
    <Tabs
      value={active}
      onValueChange={(value) => onTabChange(parseSampleReadingTab(value))}
      className="gap-4"
      data-testid="sample-reading-tabs"
    >
      {/* Reserve a pixel for the line indicator so it does not create vertical overflow. */}
      <div className="border-border -mx-4 overflow-x-auto border-b px-4 pb-px sm:mx-0 sm:px-0">
        <TabsList variant="line" className="h-9 gap-1">
          <TabsTrigger value="overview" className="gap-1.5 px-3">
            <Workflow className="h-3.5 w-3.5" aria-hidden />
            Overview
          </TabsTrigger>
          {docs && (
            <TabsTrigger value="docs" className="gap-1.5 px-3">
              <BookText className="h-3.5 w-3.5" aria-hidden />
              Documentation
            </TabsTrigger>
          )}
          <TabsTrigger value="logs" className="gap-1.5 px-3">
            <ScrollText className="h-3.5 w-3.5" aria-hidden />
            Logs
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="overview" className="tab-fade">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
          <div className="bg-muted border-border relative aspect-video w-full max-w-3xl overflow-hidden rounded-xl border">
            <SamplePreviewImage
              sample={sample}
              priority
              className="object-cover"
              sizes="(max-width: 1024px) 100vw, 40vw"
            />
          </div>
          <div className="min-w-0 space-y-4">
            <p className="text-foreground/90 max-w-prose leading-relaxed whitespace-pre-line">
              {sample.longDescription}
            </p>
            {labels.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
                {labels.map((label) => (
                  <li
                    key={label}
                    className="bg-muted/70 text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-medium"
                  >
                    {label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </TabsContent>

      {docs && (
        <TabsContent value="docs" className="tab-fade">
          {docs.status === 'ok' ? (
            <div
              data-testid="sample-docs-prose"
              className="prose prose-neutral dark:prose-invert max-w-none [&_blockquote]:max-w-3xl [&_h1]:max-w-3xl [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:max-w-3xl [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:max-w-3xl [&_h4]:max-w-3xl [&_img]:max-w-full [&_li]:max-w-3xl [&_p]:max-w-3xl [&_p]:leading-relaxed [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_ul]:list-disc [&_ul]:pl-5"
            >
              <Streamdown>{docs.markdown}</Streamdown>
            </div>
          ) : (
            <EmptyState
              icon={BookText}
              title="Guide unavailable"
              description="The guide for this sample could not be loaded."
            >
              <Button
                variant="outline"
                size="sm"
                className="mt-4 gap-2"
                onClick={() => router.refresh()}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Reload
              </Button>
            </EmptyState>
          )}
        </TabsContent>
      )}

      <TabsContent
        value="logs"
        forceMount
        ref={logsPanelRef}
        tabIndex={-1}
        data-testid="sample-logs-panel"
        className="tab-fade outline-none data-[state=inactive]:hidden"
      >
        {logServices.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            None of this sample&apos;s services expose log sources.
          </p>
        ) : (
          logsVisited && (
            <ServiceLogTabs
              services={logServices}
              value={activeLogService}
              onValueChange={onLogServiceChange}
              orientation="horizontal"
              listContainerClassName="overflow-x-auto"
              listClassName="px-1"
              contentClassName="pt-4"
            />
          )
        )}
      </TabsContent>
    </Tabs>
  )
}

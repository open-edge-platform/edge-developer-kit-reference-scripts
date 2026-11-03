// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  Activity,
  ArrowRight,
  Layers3,
  Loader,
  RefreshCw,
  Server,
  Sparkles,
} from 'lucide-react'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import { MetricCard } from '@/components/dashboard/metric-card'
import { NeedsAttention } from '@/components/dashboard/needs-attention'
import { NextSteps } from '@/components/dashboard/next-steps'
import { RecentWork } from '@/components/dashboard/recent-work'
import {
  SuggestedSamples,
  useSampleSuggestions,
} from '@/components/dashboard/suggested-samples'
import { ServiceCard } from '@/components/services/service-card'
import { ServiceCardSkeleton } from '@/components/services/service-card-skeleton'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useServiceActivity,
  useServiceStatus,
} from '@/context/service-status-context'
import { samples } from '@/samples/registry'
import { getServiceLiveStatus, type Service } from '@/services/types'

/** Running services first, then the ones added: the dashboard's three. */
function previewServices(services: Service[]): Service[] {
  const running = (s: Service) => Number(getServiceLiveStatus(s) === 'online')
  return [...services]
    .sort(
      (a, b) =>
        running(b) - running(a) || Number(!!b.added) - Number(!!a.added),
    )
    .slice(0, 3)
}

/** The live, status-driven part of the dashboard below the hero. */
export function DashboardOverview() {
  const { services, loading, connectionError, refreshServices } =
    useServiceStatus()
  const { refreshing } = useServiceActivity()
  const { suggestions, settled } = useSampleSuggestions()
  const visibleServices = services.filter((s) => !s.hidden)
  // Status as of now: neither still loading nor the last answer kept after
  // the connection was lost.
  const live = !loading && !connectionError
  const onlineCount = visibleServices.filter(
    (s) => getServiceLiveStatus(s) === 'online',
  ).length
  const addedCount = visibleServices.filter((s) => s.added).length

  return (
    <>
      {live && <NeedsAttention services={visibleServices} />}

      <section aria-label="Workspace overview" aria-busy={loading}>
        {loading ? (
          <div
            role="status"
            className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
          >
            <span className="sr-only">Loading workspace overview…</span>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="glass-card rounded-2xl p-5">
                <Skeleton className="mb-4 h-4 w-24" />
                <Skeleton className="h-9 w-16" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <MetricCard
              label="Available services"
              value={String(visibleServices.length)}
              icon={Server}
              tone="primary"
              index={0}
              href="/services"
            />
            <MetricCard
              label="Services running"
              value={connectionError ? '—' : String(onlineCount)}
              icon={Activity}
              tone="success"
              index={1}
              href="/services?filter=running"
            />
            <MetricCard
              label="Added to workspace"
              value={connectionError ? '—' : String(addedCount)}
              icon={Layers3}
              index={2}
              href="/services?filter=added"
            />
            <MetricCard
              label="Samples to explore"
              value={String(samples.length)}
              icon={Sparkles}
              tone="info"
              index={3}
              href="/samples"
            />
          </div>
        )}
      </section>

      <div
        className="section-fade grid gap-4 lg:grid-cols-5"
        style={{ '--stagger': 1 } as CSSProperties}
      >
        <RecentWork className="lg:col-span-3" />
        <NextSteps
          className="lg:col-span-2"
          services={visibleServices}
          live={live}
          suggestions={suggestions}
        />
      </div>

      <section
        className="section-fade"
        style={{ '--stagger': 1 } as CSSProperties}
        aria-labelledby="services-title"
        aria-busy={loading}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2
            id="services-title"
            className="text-lg font-semibold tracking-tight"
          >
            Services
          </h2>
          <div className="flex items-center gap-2">
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={refreshServices}
              disabled={refreshing}
              aria-label="Refresh service status"
            >
              {refreshing ? (
                <Loader className="animate-spin" />
              ) : (
                <RefreshCw className="text-muted-foreground" />
              )}
            </Button>
            <Link
              href="/services"
              className="view-all-link text-primary flex items-center gap-1.5 text-xs font-semibold"
            >
              All services
              <ArrowRight
                aria-hidden="true"
                className="view-all-arrow size-3.5"
              />
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <ServiceCardSkeleton key={i} lines={2} />
              ))
            : previewServices(visibleServices).map((service, i) => (
                <ServiceCard key={service.id} service={service} index={i} />
              ))}
        </div>
      </section>

      <SuggestedSamples suggestions={suggestions} settled={settled} />
    </>
  )
}

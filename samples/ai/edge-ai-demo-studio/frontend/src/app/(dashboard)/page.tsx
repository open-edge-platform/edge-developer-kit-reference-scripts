// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Activity, Pause, Server, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { MetricCard } from '@/components/dashboard/metric-card'
import { SampleCard } from '@/components/dashboard/samples/sample-card'
import { ServiceCard } from '@/components/dashboard/service-card'
import { Skeleton } from '@/components/ui/skeleton'
import { useServiceStatus } from '@/context/service-status-context'
import { visibleServices } from '@/services/registry'
import { samples } from '@/samples/registry'

export default function DashboardPage() {
  const { statusMap, loading } = useServiceStatus()

  const onlineCount = loading
    ? 0
    : visibleServices.filter((s) => (statusMap[s.id] ?? s.status) === 'online')
        .length
  const offlineCount = loading
    ? 0
    : visibleServices.filter((s) => {
        const st = statusMap[s.id] ?? s.status
        return st === 'offline' || st === 'starting'
      }).length
  const featuredSamples = samples.slice(0, 3)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-foreground text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Overview of your Intel AI microservices and samples.
        </p>
      </div>

      {loading ? (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="glass-card rounded-xl px-5 py-4">
                <Skeleton className="mb-2 h-3 w-20" />
                <Skeleton className="h-8 w-12" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="glass-card flex items-center gap-4 rounded-xl p-5"
              >
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-36" />
                </div>
              </div>
            ))}
          </div>
          <div>
            <Skeleton className="mb-4 h-6 w-36" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="glass-card rounded-xl p-5">
                  <div className="flex items-start gap-3">
                    <Skeleton className="h-11 w-11 rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <div
            className="section-fade grid grid-cols-2 gap-4 md:grid-cols-4"
            style={{ '--stagger': 0 } as React.CSSProperties}
          >
            <MetricCard
              label="Total Services"
              value={String(visibleServices.length)}
              icon={Server}
              accent="blue"
              index={0}
            />
            <MetricCard
              label="Running"
              value={String(onlineCount)}
              icon={Activity}
              accent="green"
              index={1}
            />
            <MetricCard
              label="Stopped"
              value={String(offlineCount)}
              icon={Pause}
              index={2}
            />
            <MetricCard
              label="Samples"
              value={String(samples.length)}
              icon={Sparkles}
              accent="cyan"
              index={3}
            />
          </div>

          <div
            className="section-fade"
            style={{ '--stagger': 1 } as React.CSSProperties}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-foreground text-lg font-semibold">
                  Active Services
                </h2>
                <span className="bg-status-online/15 text-status-online flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold">
                  {onlineCount}
                </span>
              </div>
              <Link
                href="/services"
                className="view-all-link text-primary hover:text-primary-light text-sm font-medium"
              >
                View all <span className="view-all-arrow">→</span>
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {visibleServices
                .sort(
                  (a, b) =>
                    ((statusMap[b.id] ?? b.status) === 'online' ? 1 : 0) -
                    ((statusMap[a.id] ?? a.status) === 'online' ? 1 : 0),
                )
                .slice(0, 3)
                .map((service, i) => (
                  <ServiceCard key={service.id} service={service} index={i} />
                ))}
            </div>
          </div>

          <div
            className="section-fade"
            style={{ '--stagger': 2 } as React.CSSProperties}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-foreground text-lg font-semibold">
                  Featured Samples
                </h2>
                <span className="bg-primary/15 text-primary flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold">
                  {samples.length}
                </span>
              </div>
              <Link
                href="/samples"
                className="view-all-link text-primary hover:text-primary-light text-sm font-medium"
              >
                View gallery <span className="view-all-arrow">→</span>
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {featuredSamples.map((s, i) => (
                <div
                  key={s.id}
                  className="card-stagger"
                  style={{ '--card-index': i } as React.CSSProperties}
                >
                  <SampleCard sample={s} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

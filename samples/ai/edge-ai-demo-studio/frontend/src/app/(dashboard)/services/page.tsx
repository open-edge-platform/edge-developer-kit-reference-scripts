// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Activity, Ban, PowerOff, Server } from 'lucide-react'
import { ServiceCard } from '@/components/dashboard/service-card'
import { Skeleton } from '@/components/ui/skeleton'
import { useServiceStatus } from '@/context/service-status-context'
import { useSystemInfo } from '@/context/system-info-context'
import { isServiceSupportedOnOS, visibleServices } from '@/services/registry'

export default function ServicesPage() {
  const { systemInfo } = useSystemInfo()
  const { statusMap, loading } = useServiceStatus()

  const supported = systemInfo
    ? visibleServices.filter((s) => isServiceSupportedOnOS(s, systemInfo.os))
    : visibleServices

  const unsupported = systemInfo
    ? visibleServices.filter((s) => !isServiceSupportedOnOS(s, systemInfo.os))
    : []

  const running = supported.filter(
    (s) => (statusMap[s.id] ?? s.status) === 'online',
  )
  const stopped = supported.filter(
    (s) => (statusMap[s.id] ?? s.status) !== 'online',
  )

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="from-primary/15 to-secondary/10 shadow-primary/10 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm">
              <Server className="text-primary h-5 w-5" />
            </div>
            <h1 className="text-foreground text-2xl font-bold">Services</h1>
          </div>
          <p className="text-muted-foreground mt-2 max-w-lg text-sm leading-relaxed">
            Manage your AI microservices. Toggle services on and off, view
            configurations, and monitor performance. First startup may take
            several minutes while required packages are installed.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-28 rounded-full" />
            <Skeleton className="h-8 w-28 rounded-full" />
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="bg-status-online/10 border-status-online/15 flex items-center gap-2 rounded-full border px-3.5 py-1.5">
              <span className="bg-status-online status-pulse h-2 w-2 rounded-full" />
              <span className="text-muted-foreground text-sm">
                <span className="text-foreground font-bold">
                  {running.length}
                </span>{' '}
                Running
              </span>
            </div>
            <div className="bg-muted/50 border-border flex items-center gap-2 rounded-full border px-3.5 py-1.5">
              <span className="bg-status-offline h-2 w-2 rounded-full" />
              <span className="text-muted-foreground text-sm">
                <span className="text-foreground font-bold">
                  {stopped.length}
                </span>{' '}
                Stopped
              </span>
            </div>
            {unsupported.length > 0 && (
              <div className="flex items-center gap-2 rounded-full border border-orange-500/15 bg-orange-500/10 px-3.5 py-1.5">
                <Ban className="h-3 w-3 text-orange-400" />
                <span className="text-muted-foreground text-sm">
                  <span className="text-foreground font-bold">
                    {unsupported.length}
                  </span>{' '}
                  Unsupported
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-8">
          <div>
            <Skeleton className="mb-4 h-5 w-24" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="glass-card rounded-xl p-5">
                  <div className="flex items-start gap-3">
                    <Skeleton className="h-11 w-11 rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          {running.length > 0 && (
            <div
              className="section-fade"
              style={{ '--stagger': 0 } as React.CSSProperties}
            >
              <div className="mb-4 flex items-center gap-2.5">
                <Activity className="text-status-online h-4 w-4" />
                <h2 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
                  Running
                </h2>
                <span className="bg-status-online/15 text-status-online flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold">
                  {running.length}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {running.map((service, i) => (
                  <ServiceCard key={service.id} service={service} index={i} />
                ))}
              </div>
            </div>
          )}

          {stopped.length > 0 && (
            <div
              className="section-fade"
              style={{ '--stagger': 1 } as React.CSSProperties}
            >
              <div className="mb-4 flex items-center gap-2.5">
                <PowerOff className="text-muted-foreground/60 h-4 w-4" />
                <h2 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
                  Stopped
                </h2>
                <span className="bg-muted text-muted-foreground flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold">
                  {stopped.length}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 opacity-75 transition-opacity duration-300 hover:opacity-100 md:grid-cols-2 lg:grid-cols-3">
                {stopped.map((service, i) => (
                  <ServiceCard key={service.id} service={service} index={i} />
                ))}
              </div>
            </div>
          )}

          {unsupported.length > 0 && (
            <div
              className="section-fade"
              style={{ '--stagger': 2 } as React.CSSProperties}
            >
              <div className="mb-4 flex items-center gap-2.5">
                <Ban className="h-4 w-4 text-orange-400/60" />
                <h2 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
                  Unsupported on this system
                </h2>
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-orange-500/10 px-1.5 text-[10px] font-bold text-orange-400">
                  {unsupported.length}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {unsupported.map((service, i) => (
                  <ServiceCard
                    key={service.id}
                    service={service}
                    unsupportedOS
                    currentOS={systemInfo?.os}
                    index={i}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

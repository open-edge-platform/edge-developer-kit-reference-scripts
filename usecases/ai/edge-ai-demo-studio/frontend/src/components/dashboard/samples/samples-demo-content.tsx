// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AlertTriangle,
  ArrowLeft,
  CircleDot,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { StatusIndicator } from '@/components/common/status-indicator'
import { StartAllServicesButton } from '@/components/dashboard/samples/start-all-services-button'
import { SampleDemo } from '@/components/dashboard/samples/samples-demo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useGetServices } from '@/context/service-status-context'
import { cn } from '@/lib/utils'
import { SampleParamsSlotContext } from '@/samples/common/sample-params-slot'
import { getSampleById } from '@/samples/registry'
import { getOptionalDeps, getRequiredDeps } from '@/samples/types'
import type { Service } from '@/services/types'

export function SampleDemoContent({ sampleId }: { sampleId: string }) {
  const sample = getSampleById(sampleId)!
  const requiredDeps = getRequiredDeps(sample)
  const optDeps = getOptionalDeps(sample)

  const allDepIds = [
    ...requiredDeps.map((d) => d.serviceId),
    ...optDeps.map((d) => d.serviceId),
  ]
  const serviceMap = useGetServices(allDepIds)

  const requiredServices = requiredDeps
    .map((d) => serviceMap[d.serviceId])
    .filter(Boolean) as Service[]

  const optionalServices = optDeps
    .map((d) => serviceMap[d.serviceId])
    .filter(Boolean) as Service[]

  const requiredOnline = requiredServices.filter(
    (s) => s.status === 'online',
  ).length
  const allRequiredOnline = requiredOnline === requiredServices.length
  const hasOptional = optionalServices.length > 0

  const [paramsSlot, setParamsSlot] = useState<HTMLDivElement | null>(null)

  return (
    <div className="space-y-5">
      {/* ─── Back link (above toolbar) ───────────────────────────── */}
      <Link
        href={`/samples/${sample.id}`}
        className="group text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm transition-colors"
      >
        <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
        Back to {sample.title}
      </Link>

      {/* ─── Toolbar ─────────────────────────────────────────────── */}
      <div className="glass-card relative overflow-hidden rounded-xl">
        {/* Gradient accent bar */}
        <div
          className={cn(
            'h-1',
            allRequiredOnline
              ? 'from-primary to-secondary bg-gradient-to-r'
              : 'from-primary/40 to-muted bg-gradient-to-r',
          )}
        />

        {/* Decorative background glow */}
        <div className="from-primary/[0.04] via-secondary/[0.02] pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent" />

        <div className="relative flex flex-wrap items-center justify-between gap-4 px-4 py-3">
          {/* Left: title */}
          <h1 className="text-foreground text-base leading-tight font-semibold">
            {sample.title}
          </h1>

          {/* Right: service status + actions */}
          <div className="flex items-center gap-3">
            {/* Compact service status summary */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors',
                    allRequiredOnline
                      ? 'border-success/20 bg-success/5'
                      : 'border-rose-500/20 bg-rose-500/5',
                  )}
                >
                  {/* Stacked status dots */}
                  <span className="flex -space-x-1">
                    {requiredServices.map((s) => (
                      <span
                        key={s.id}
                        className={cn(
                          'ring-background inline-block h-2 w-2 rounded-full ring-1',
                          s.status === 'online' && 'bg-success',
                          s.status === 'starting' && 'bg-warning animate-pulse',
                          s.status !== 'online' &&
                            s.status !== 'starting' &&
                            'bg-rose-400',
                        )}
                      />
                    ))}
                  </span>
                  <span
                    className={cn(
                      'font-medium',
                      allRequiredOnline ? 'text-success' : 'text-rose-400',
                    )}
                  >
                    {requiredOnline}/{requiredServices.length}
                  </span>
                  <span className="text-muted-foreground hidden sm:inline">
                    services
                  </span>
                  {hasOptional && (
                    <span className="text-muted-foreground/60">
                      +{optionalServices.length}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                className="bg-background border-border w-56 rounded-lg border p-0 shadow-lg"
              >
                <div className="space-y-0.5 p-2">
                  <p className="text-foreground mb-2 px-1 text-[11px] font-semibold tracking-wider uppercase">
                    Required
                  </p>
                  {requiredServices.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-2 rounded-md px-1.5 py-1"
                    >
                      <s.icon className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                      <span className="text-foreground flex-1 truncate text-xs">
                        {s.name}
                      </span>
                      <span
                        className={cn(
                          'h-1.5 w-1.5 shrink-0 rounded-full',
                          s.status === 'online' && 'bg-success',
                          s.status === 'starting' && 'bg-warning animate-pulse',
                          s.status !== 'online' &&
                            s.status !== 'starting' &&
                            'bg-rose-400',
                        )}
                      />
                    </div>
                  ))}
                  {hasOptional && (
                    <>
                      <div className="bg-border my-1 h-px" />
                      <p className="text-muted-foreground mb-1 px-1 text-[11px] font-semibold tracking-wider uppercase">
                        Optional
                      </p>
                      {optionalServices.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center gap-2 rounded-md px-1.5 py-1"
                        >
                          <s.icon className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                          <span className="text-muted-foreground flex-1 truncate text-xs">
                            {s.name}
                          </span>
                          <span
                            className={cn(
                              'h-1.5 w-1.5 shrink-0 rounded-full',
                              s.status === 'online'
                                ? 'bg-success'
                                : 'bg-muted-foreground/30',
                            )}
                          />
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>

            {/* Portal target for DemoConfigSheet rendered by each demo */}
            <div ref={setParamsSlot} />
          </div>
        </div>
      </div>

      {/* ─── Blocked state ───────────────────────────────────────── */}
      {!allRequiredOnline ? (
        <div className="glass-card relative overflow-hidden rounded-xl">
          {/* Subtle gradient accent at top */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-rose-500/10 via-rose-500/5 to-transparent" />

          <div className="flex flex-col items-center justify-center px-6 py-20 text-center sm:py-28">
            {/* Icon */}
            <div className="relative mb-6">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-rose-500/10 ring-1 ring-rose-500/20">
                <AlertTriangle className="h-9 w-9 text-rose-400" />
              </div>
            </div>

            {/* Copy */}
            <h3 className="text-foreground text-xl font-semibold tracking-tight">
              Services Required
            </h3>
            <p className="text-muted-foreground mt-2 max-w-lg text-sm leading-relaxed">
              {requiredServices.length - requiredOnline} of{' '}
              {requiredServices.length} required service
              {requiredServices.length === 1 ? ' is' : 's are'} offline. Start
              them to begin using this demo.
            </p>

            {/* Offline service badges */}
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {requiredServices
                .filter((s) => s.status !== 'online')
                .map((s) => (
                  <Badge
                    key={s.id}
                    variant="outline"
                    className="gap-2 border-rose-500/20 py-1.5 pr-3 pl-2.5 text-rose-300"
                  >
                    <s.icon className="h-3.5 w-3.5" />
                    {s.name}
                    <StatusIndicator status={s.status} />
                  </Badge>
                ))}
            </div>

            {/* Online services (show what's already ready) */}
            {requiredOnline > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                {requiredServices
                  .filter((s) => s.status === 'online')
                  .map((s) => (
                    <Badge
                      key={s.id}
                      variant="outline"
                      className="border-success/20 text-success/80 gap-2 py-1.5 pr-3 pl-2.5"
                    >
                      <s.icon className="h-3.5 w-3.5" />
                      {s.name}
                      <ShieldCheck className="h-3 w-3" />
                    </Badge>
                  ))}
              </div>
            )}

            {/* CTAs */}
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
              <StartAllServicesButton
                serviceIds={requiredServices.map((s) => s.id)}
                label="Start All Services"
                className="bg-primary hover:bg-primary-light shadow-primary/10 text-white shadow-lg"
              />
              <Link href={`/samples/${sample.id}`}>
                <Button variant="outline" size="lg" className="gap-2">
                  <Settings className="h-4 w-4" />
                  Go to Configuration
                </Button>
              </Link>
            </div>

            {/* Progress hint */}
            <p className="text-muted-foreground/60 mt-6 flex items-center gap-1.5 text-xs">
              <CircleDot className="h-3 w-3" />
              {requiredOnline}/{requiredServices.length} services ready
            </p>
          </div>
        </div>
      ) : (
        /* ─── Demo content (full width, primary focus) ──────────── */
        <SampleParamsSlotContext.Provider value={paramsSlot}>
          <SampleDemo sample={sample} />
        </SampleParamsSlotContext.Provider>
      )}
    </div>
  )
}

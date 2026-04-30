// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  ImageIcon,
  Info,
  Play,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { StartAllServicesButton } from '@/components/dashboard/samples/start-all-services-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useGetServices } from '@/context/service-status-context'
import { cn } from '@/lib/utils'
import type { Service } from '@/services/types'
import { getSampleById } from '@/samples/registry'
import {
  getDeviceMap,
  getOptionalDeps,
  getReadinessLabel,
  getRequiredDeps,
} from '@/samples/types'
import type {
  PipelineStep,
  ReadinessStatus,
  ServiceDependency,
} from '@/samples/types'

export function SampleDetailContent({ sampleId }: { sampleId: string }) {
  const sample = getSampleById(sampleId)!
  const requiredDeps = getRequiredDeps(sample)
  const optDeps = getOptionalDeps(sample)
  const deviceMap = getDeviceMap(sample)

  const allDepIds = sample.dependencies.map((d) => d.serviceId)
  const serviceMap = useGetServices(allDepIds)

  const requiredServices = requiredDeps
    .map((d) => serviceMap[d.serviceId])
    .filter(Boolean) as Service[]

  const optionalServices = optDeps
    .map((d) => serviceMap[d.serviceId])
    .filter(Boolean) as Service[]

  const pipelineSteps: PipelineStep[] =
    sample.pipeline ?? sample.dependencies.map((d) => d.serviceId)

  const requiredOnline = requiredServices.filter(
    (s) => s.status === 'online',
  ).length
  const optionalOnline = optionalServices.filter(
    (s) => s.status === 'online',
  ).length
  const totalOnline = requiredOnline + optionalOnline
  const totalServices = requiredServices.length + optionalServices.length

  const allRequiredOnline = requiredOnline === requiredServices.length
  const hasOptional = optionalServices.length > 0

  const readiness: ReadinessStatus = !allRequiredOnline
    ? 'blocked'
    : !hasOptional || optionalOnline === optionalServices.length
      ? 'ready'
      : 'partial'
  const readinessLabel = getReadinessLabel(readiness)

  return (
    <>
      <div className="glass-card relative overflow-hidden rounded-xl">
        <div
          className={cn(
            'h-1',
            (readiness === 'ready' || readiness === 'partial') &&
              'from-primary to-secondary bg-gradient-to-r',
            readiness === 'blocked' &&
              'from-primary/40 to-muted bg-gradient-to-r',
          )}
        />

        <div className="from-primary/[0.04] via-secondary/[0.02] pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent" />

        <div className="relative flex flex-col gap-6 p-5 md:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <div className="relative shrink-0">
                <div
                  className={cn(
                    'flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl ring-1 ring-offset-2 ring-offset-[var(--glass-bg)] transition-all',
                    readiness === 'ready' && 'ring-success/30',
                    readiness === 'partial' && 'ring-info/30',
                    readiness === 'blocked' && 'ring-border',
                  )}
                >
                  {sample.image ? (
                    <Image
                      src={sample.image}
                      alt={sample.title}
                      width={56}
                      height={56}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="from-primary/20 to-secondary/10 flex h-full w-full items-center justify-center bg-gradient-to-br">
                      <ImageIcon className="text-muted-foreground/40 h-7 w-7" />
                    </div>
                  )}
                </div>
                <span
                  className={cn(
                    'absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full ring-2 ring-[var(--glass-bg)]',
                    readiness === 'ready' && 'bg-success',
                    readiness === 'partial' && 'bg-info',
                    readiness === 'blocked' && 'bg-muted-foreground/50',
                  )}
                />
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-foreground text-2xl font-bold tracking-tight">
                    {sample.title}
                  </h1>
                  <Badge variant="secondary" className="text-xs">
                    {sample.category}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-1.5 max-w-2xl text-sm leading-relaxed">
                  {sample.longDescription}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <div
                className={cn(
                  'hidden items-center gap-2 rounded-lg px-3 py-2 lg:flex',
                  readiness === 'ready' && 'bg-success/10',
                  readiness === 'partial' && 'bg-info/10',
                  readiness === 'blocked' && 'bg-muted/60',
                )}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full',
                    readiness === 'ready' && 'bg-success/20',
                    readiness === 'partial' && 'bg-info/20',
                    readiness === 'blocked' && 'bg-muted-foreground/20',
                  )}
                >
                  {readiness === 'ready' ? (
                    <CheckCircle2
                      className="text-success h-3 w-3"
                      aria-hidden
                    />
                  ) : readiness === 'partial' ? (
                    <Info className="text-info h-3 w-3" aria-hidden />
                  ) : (
                    <Info
                      className="text-muted-foreground h-3 w-3"
                      aria-hidden
                    />
                  )}
                </span>
                <div className="flex flex-col">
                  <span
                    className={cn(
                      'text-[11px] leading-tight font-semibold',
                      readiness === 'ready' && 'text-success',
                      readiness === 'partial' && 'text-info',
                      readiness === 'blocked' && 'text-muted-foreground',
                    )}
                  >
                    {readinessLabel}
                  </span>
                  <span className="text-muted-foreground text-[10px] leading-tight">
                    {totalOnline}/{totalServices} online
                  </span>
                </div>
              </div>

              {sample.demo.type === 'external' && sample.demo.externalUrl ? (
                <Button
                  asChild
                  size="lg"
                  className={cn(
                    'gap-2',
                    allRequiredOnline
                      ? 'bg-primary hover:bg-primary-light shadow-primary/20 text-white shadow-sm'
                      : 'bg-muted text-muted-foreground pointer-events-none cursor-not-allowed',
                  )}
                >
                  <a
                    href={
                      allRequiredOnline ? sample.demo.externalUrl : undefined
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-disabled={!allRequiredOnline}
                  >
                    <ExternalLink className="h-4 w-4" />
                    {sample.demo.externalLabel ?? 'Open Demo'}
                  </a>
                </Button>
              ) : (
                <Button
                  asChild
                  size="lg"
                  className={cn(
                    'gap-2',
                    allRequiredOnline
                      ? 'bg-primary hover:bg-primary-light shadow-primary/20 text-white shadow-sm'
                      : 'bg-muted text-muted-foreground pointer-events-none cursor-not-allowed',
                  )}
                >
                  <Link
                    data-testid="launch-button"
                    href={
                      allRequiredOnline ? `/samples/${sample.id}/demo` : '#'
                    }
                    aria-disabled={!allRequiredOnline}
                  >
                    <Play className="h-4 w-4" />
                    Launch Demo
                  </Link>
                </Button>
              )}
            </div>
          </div>

          <div className="border-border/50 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4">
            <div className="flex flex-wrap gap-1.5">
              {sample.tags.map((tag) => (
                <span
                  key={tag}
                  className="bg-muted/70 text-muted-foreground hover:bg-muted rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors"
                >
                  {tag}
                </span>
              ))}
            </div>

            <span
              className={cn(
                'ml-auto flex items-center gap-1.5 text-[11px] lg:hidden',
                readiness === 'ready'
                  ? 'text-success'
                  : readiness === 'partial'
                    ? 'text-info'
                    : 'text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'inline-block h-1.5 w-1.5 rounded-full',
                  readiness === 'ready' && 'bg-success',
                  readiness === 'partial' && 'bg-info',
                  readiness === 'blocked' && 'bg-muted-foreground',
                )}
              />
              {readinessLabel} · {totalOnline}/{totalServices} online
            </span>
          </div>
        </div>
      </div>

      <div className="glass-card overflow-hidden rounded-xl">
        <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5">
          <div className="flex items-center gap-3">
            <h2 className="text-foreground text-sm font-semibold">Services</h2>
            <Badge
              variant="outline"
              className={cn(
                'text-[11px]',
                readiness === 'ready' &&
                  'border-success/20 bg-success/10 text-success',
                readiness === 'partial' &&
                  'border-info/20 bg-info/10 text-info',
                readiness === 'blocked' &&
                  'border-border bg-muted text-muted-foreground',
              )}
            >
              {totalOnline}/{totalServices} · {readinessLabel}
            </Badge>
          </div>
          {!allRequiredOnline && (
            <StartAllServicesButton
              serviceIds={requiredServices.map((s) => s.id)}
              deviceMap={deviceMap}
              label="Start Required"
            />
          )}
          {allRequiredOnline &&
            hasOptional &&
            optionalOnline < optionalServices.length && (
              <StartAllServicesButton
                serviceIds={optionalServices.map((s) => s.id)}
                deviceMap={deviceMap}
                label="Start Optional"
              />
            )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px]">
          <div className="divide-border divide-y">
            {!allRequiredOnline && (
              <div className="flex items-center gap-2.5 bg-rose-500/5 px-5 py-2.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                <p className="text-xs text-rose-400">
                  {requiredServices.length - requiredOnline} required service(s)
                  offline — start them to launch the demo
                </p>
              </div>
            )}
            {allRequiredOnline &&
              hasOptional &&
              optionalOnline < optionalServices.length && (
                <div className="bg-info/5 flex items-center gap-2.5 px-5 py-2.5">
                  <Info className="text-info h-3.5 w-3.5 shrink-0" />
                  <p className="text-info text-xs">
                    Demo ready with reduced capabilities — optional services
                    offline
                  </p>
                </div>
              )}
            {allRequiredOnline &&
              (!hasOptional || optionalOnline === optionalServices.length) && (
                <div className="bg-success/5 flex items-center gap-2.5 px-5 py-2.5">
                  <CheckCircle2 className="text-success h-3.5 w-3.5 shrink-0" />
                  <p className="text-success text-xs">
                    All services online — ready to launch
                  </p>
                </div>
              )}

            {requiredServices.map((s) => (
              <ServiceRow key={s.id} service={s} />
            ))}

            {hasOptional && (
              <>
                <div className="bg-muted/30 px-5 py-2">
                  <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                    Optional
                  </p>
                </div>
                {optionalServices.map((s) => {
                  const dep = optDeps.find((d) => d.serviceId === s.id)
                  return (
                    <ServiceRow
                      key={s.id}
                      service={s}
                      optional
                      dependency={dep}
                    />
                  )
                })}
              </>
            )}
          </div>

          <div className="border-border hidden border-l lg:block">
            <div className="px-4 py-3.5">
              <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                Pipeline
              </p>
            </div>
            <div className="flex flex-col items-start gap-0 px-6 pb-5">
              {pipelineSteps.map((step, stepIdx) => {
                const ids = Array.isArray(step) ? step : [step]
                const stepServices = ids
                  .map((id) => serviceMap[id])
                  .filter(Boolean) as Service[]
                if (stepServices.length === 0) return null
                const isLast = stepIdx === pipelineSteps.length - 1
                const isParallel =
                  Array.isArray(step) && stepServices.length > 1

                if (isParallel) {
                  return (
                    <div
                      key={ids.join('+')}
                      className="flex flex-col items-start"
                    >
                      <div className="border-border/60 rounded-lg border border-dashed p-1.5">
                        <div className="flex flex-col gap-1">
                          {stepServices.map((s) => {
                            const isOptional = optDeps.some(
                              (d) => d.serviceId === s.id,
                            )
                            return (
                              <div
                                key={s.id}
                                className="flex items-center gap-2"
                              >
                                <div
                                  className={cn(
                                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                                    isOptional
                                      ? cn(
                                          'border border-dashed',
                                          s.status === 'online'
                                            ? 'border-secondary/40 bg-secondary/15 text-secondary'
                                            : 'border-border bg-muted text-muted-foreground',
                                        )
                                      : s.status === 'online'
                                        ? 'bg-primary/20 text-primary ring-primary/30 ring-2'
                                        : 'bg-muted text-muted-foreground ring-border ring-1',
                                  )}
                                >
                                  <s.icon className="h-3 w-3" />
                                </div>
                                <span
                                  className={cn(
                                    'text-[11px]',
                                    isOptional
                                      ? 'text-muted-foreground'
                                      : 'text-foreground font-medium',
                                  )}
                                >
                                  {s.name}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                      {!isLast && (
                        <div className="bg-border ml-[13px] h-5 w-px" />
                      )}
                    </div>
                  )
                }

                const s = stepServices[0]
                const isOptional = optDeps.some((d) => d.serviceId === s.id)
                return (
                  <div key={s.id} className="flex flex-col items-start">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                          isOptional
                            ? cn(
                                'border border-dashed',
                                s.status === 'online'
                                  ? 'border-secondary/40 bg-secondary/15 text-secondary'
                                  : 'border-border bg-muted text-muted-foreground',
                              )
                            : s.status === 'online'
                              ? 'bg-primary/20 text-primary ring-primary/30 ring-2'
                              : 'bg-muted text-muted-foreground ring-border ring-1',
                        )}
                      >
                        <s.icon className="h-3.5 w-3.5" />
                      </div>
                      <span
                        className={cn(
                          'text-xs',
                          isOptional
                            ? 'text-muted-foreground'
                            : 'text-foreground font-medium',
                        )}
                      >
                        {s.name}
                      </span>
                    </div>
                    {!isLast && (
                      <div className="bg-border ml-[13px] h-5 w-px" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function ServiceRow({
  service: s,
  optional,
  dependency,
}: {
  service: Service
  optional?: boolean
  dependency?: ServiceDependency
}) {
  const content = (
    <>
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          optional && 'border border-dashed',
          optional
            ? s.status === 'online'
              ? 'border-secondary/30 bg-secondary/10 text-secondary'
              : 'border-border bg-muted text-muted-foreground'
            : s.status === 'online'
              ? 'bg-primary/15 text-primary'
              : 'bg-muted text-muted-foreground',
        )}
      >
        <s.icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-foreground truncate text-sm font-medium">
              {s.name}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {optional && dependency?.impactText && dependency.impactText}
            </p>
          </div>

          {s.status === 'online' && (
            <div className="flex shrink-0 items-center gap-2">
              {s.currentModel && (
                <Badge
                  variant="secondary"
                  className="bg-primary/10 text-primary border-primary/15 inline-flex max-w-[160px] items-center gap-1 text-[11px] font-medium"
                >
                  <Download className="h-3 w-3 shrink-0" />
                  <span className="max-w-[120px] truncate">
                    {s.currentModel}
                  </span>
                </Badge>
              )}

              {s.currentDevice && (
                <Badge
                  variant="secondary"
                  className="bg-secondary/10 text-secondary border-secondary/15 inline-flex items-center gap-1 text-[11px] font-medium"
                >
                  <Cpu className="h-3 w-3 shrink-0" />
                  <span className="truncate">{s.currentDevice}</span>
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            s.status === 'online' && 'status-pulse bg-success',
            s.status === 'offline' && 'bg-muted-foreground/50',
            s.status === 'error' && 'bg-red-500',
            s.status === 'starting' && 'bg-warning animate-pulse',
          )}
        />
        <ArrowUpRight
          className={cn(
            'h-3.5 w-3.5 transition-all',
            s.hidden
              ? 'invisible'
              : 'text-muted-foreground/0 group-hover:text-muted-foreground',
          )}
        />
      </div>
    </>
  )

  if (s.hidden) {
    return <div className="flex items-center gap-3 px-5 py-3">{content}</div>
  }

  return (
    <Link
      href={`/services/${s.id}`}
      className="hover:bg-muted/30 group flex items-center gap-3 px-5 py-3 transition-colors"
    >
      {content}
    </Link>
  )
}

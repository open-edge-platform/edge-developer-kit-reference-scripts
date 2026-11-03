// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AlertTriangle,
  Boxes,
  Loader,
  type LucideIcon,
  Server,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'
import { TONES, type Tone } from '@/components/common/tones'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { getServiceById } from '@/services/registry'
import type { ExportPlan } from './hooks/use-export-bundle'

export function serviceName(id: string): string {
  return getServiceById(id)?.name ?? id
}

/** The small uppercase label above each block of the export dialog. */
export function ExportSectionLabel({
  icon: Icon,
  children,
}: {
  icon: LucideIcon
  children: ReactNode
}) {
  return (
    <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wider uppercase">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {children}
    </p>
  )
}

/** The services an export keeps, split by why, beside the derived totals. */
function planGroups(plan: ExportPlan) {
  const { required, optional, included } = plan.services
  return {
    required,
    // Declared optional services that the resolved plan actually keeps.
    optional: optional.filter((id) => included.includes(id)),
    // Services pulled in transitively (shared helpers etc.) beyond declared deps.
    additional: included.filter(
      (id) => !required.includes(id) && !optional.includes(id),
    ),
  }
}

interface PlanPreviewProps {
  plan: ExportPlan | undefined
  loading: boolean
  error: string | null
  onRetry: () => void
}

/** The services the export will contain, as the server resolved them; the last plan stays meanwhile. */
export function PlanPreview({
  plan,
  loading,
  error,
  onRetry,
}: PlanPreviewProps) {
  return (
    <div className="space-y-2">
      <ExportSectionLabel icon={Server}>Included services</ExportSectionLabel>

      {error ? (
        <div className="flex flex-wrap items-start gap-2">
          <InlineNotice
            tone="destructive"
            size="sm"
            icon={<AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />}
            className="min-w-0 flex-1"
          >
            {error} Your selection and options are kept.
          </InlineNotice>
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            disabled={loading}
          >
            Retry
          </Button>
        </div>
      ) : loading && !plan ? (
        <div
          role="status"
          aria-busy="true"
          className="border-border/60 bg-muted/15 space-y-3 rounded-xl border p-3.5"
        >
          <span className="sr-only">Resolving the export plan…</span>
          <Skeleton className="h-3 w-24" />
          <div className="flex flex-wrap gap-1.5">
            <Skeleton className="h-6 w-28 rounded-md" />
            <Skeleton className="h-6 w-24 rounded-md" />
            <Skeleton className="h-6 w-32 rounded-md" />
          </div>
          <Skeleton className="h-3 w-40" />
        </div>
      ) : plan ? (
        <ResolvedPlan plan={plan} updating={loading} />
      ) : null}
    </div>
  )
}

function ResolvedPlan({
  plan,
  updating,
}: {
  plan: ExportPlan
  updating: boolean
}) {
  const groups = planGroups(plan)
  return (
    <div className="border-border/60 bg-muted/15 relative overflow-hidden rounded-xl border">
      {updating && (
        <span className="bg-background/90 text-muted-foreground absolute top-2 right-2 z-10 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
          <Loader className="h-3 w-3 animate-spin" aria-hidden />
          Updating…
        </span>
      )}
      <ScrollArea className="max-h-56">
        <div
          className={cn(
            'space-y-3.5 p-3.5 transition-opacity duration-200',
            updating && 'opacity-60',
          )}
        >
          <ServiceGroup label="Required" ids={groups.required} tone="primary" />
          <ServiceGroup label="Optional" ids={groups.optional} tone="info" />
          <ServiceGroup
            label="Also required by shared code"
            ids={groups.additional}
            tone="muted"
          />
        </div>
      </ScrollArea>
      <div className="border-border/60 bg-muted/30 text-muted-foreground flex items-center gap-4 border-t px-3.5 py-2.5 text-xs">
        <PlanTotal
          icon={Server}
          count={plan.services.included.length}
          noun="service"
        />
        <span className="bg-border h-3 w-px" aria-hidden />
        <PlanTotal icon={Boxes} count={plan.workers.length} noun="worker" />
      </div>
    </div>
  )
}

function PlanTotal({
  icon: Icon,
  count,
  noun,
}: {
  icon: LucideIcon
  count: number
  noun: string
}) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="text-foreground font-medium tabular-nums">{count}</span>
      {count === 1 ? noun : `${noun}s`}
    </span>
  )
}

function ServiceGroup({
  label,
  ids,
  tone,
}: {
  label: string
  ids: string[]
  tone: Extract<Tone, 'primary' | 'info' | 'muted'>
}) {
  if (ids.length === 0) return null
  const dot = cn('h-1.5 w-1.5 rounded-full', TONES[tone].dot)
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <span className={dot} aria-hidden />
        {label}
        <span className="text-muted-foreground/50 tabular-nums">
          {ids.length}
        </span>
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {ids.map((id) => (
          <li
            key={id}
            className="border-border/50 bg-background/60 flex items-center gap-1.5 rounded-md border px-2 py-1"
          >
            <span className={dot} aria-hidden />
            <span className="text-foreground/80 text-xs">
              {serviceName(id)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

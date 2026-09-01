// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AlertTriangle,
  Boxes,
  Download,
  Layers,
  Loader2,
  Package,
  Server,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { getSampleById } from '@/samples/registry'
import { getServiceById } from '@/services/registry'

interface ExportPlan {
  samples: {
    id: string
    deps: { serviceId: string; role: 'required' | 'optional' }[]
  }[]
  requestedServices: string[]
  services: { required: string[]; optional: string[]; included: string[] }
  workers: string[]
  includeOptional: boolean
}

interface ExportBundleDialogProps {
  sampleIds: string[]
  /** Services to export directly — may be used alone with no samples. */
  serviceIds?: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful export download. */
  onExported?: () => void
}

function serviceName(id: string): string {
  return getServiceById(id)?.name ?? id
}

function sampleTitle(id: string): string {
  return getSampleById(id)?.title ?? id
}

export function ExportBundleDialog({
  sampleIds,
  serviceIds = [],
  open,
  onOpenChange,
  onExported,
}: ExportBundleDialogProps) {
  const [includeOptional, setIncludeOptional] = useState(false)
  const [plan, setPlan] = useState<ExportPlan | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const samplesKey = sampleIds.join(',')
  const servicesKey = serviceIds.join(',')
  const selectionCount = sampleIds.length + serviceIds.length

  // Resolve the plan whenever the dialog opens, the selection changes, or the
  // optional toggle flips — the API mirrors exactly what an export produces.
  useEffect(() => {
    if (!open || selectionCount === 0) return
    const controller = new AbortController()

    const params = new URLSearchParams({
      includeOptional: String(includeOptional),
    })
    if (samplesKey) params.set('samples', samplesKey)
    if (servicesKey) params.set('services', servicesKey)

    const loadPlan = async () => {
      setPlanLoading(true)
      setPlanError(null)
      try {
        const res = await fetch(`/api/export-bundle?${params.toString()}`, {
          signal: controller.signal,
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(body.error ?? 'Failed to resolve export plan')
        }
        const data = (await res.json()) as ExportPlan
        setPlan(data)
      } catch (err: unknown) {
        if (controller.signal.aborted) return
        setPlan(null)
        setPlanError(err instanceof Error ? err.message : 'Failed to load plan')
      } finally {
        if (!controller.signal.aborted) setPlanLoading(false)
      }
    }
    loadPlan()

    return () => controller.abort()
  }, [open, samplesKey, servicesKey, selectionCount, includeOptional])

  const handleExport = useCallback(async () => {
    setExporting(true)
    try {
      const res = await fetch('/api/export-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          samples: sampleIds,
          services: serviceIds,
          includeOptional,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'Export failed')
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = disposition.match(/filename="?([^"]+)"?/)
      const fileName = match?.[1] ?? 'edge-ai-demo-studio-samples.zip'

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)

      toast.success('Export ready', {
        description: `Downloaded ${fileName}`,
      })
      onExported?.()
      onOpenChange(false)
    } catch (err) {
      toast.error('Export failed', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setExporting(false)
    }
  }, [sampleIds, serviceIds, includeOptional, onExported, onOpenChange])

  // Declared optional services that the resolved plan actually keeps.
  const declaredOptional = plan
    ? plan.services.optional.filter((id) => plan.services.included.includes(id))
    : []
  // Services pulled in transitively (shared helpers etc.) beyond declared deps.
  const additional = plan
    ? plan.services.included.filter(
        (id) =>
          !plan.services.required.includes(id) &&
          !plan.services.optional.includes(id),
      )
    : []

  const isSingle = sampleIds.length === 1
  const samplesOnly = serviceIds.length === 0
  const servicesOnly = sampleIds.length === 0

  const title = servicesOnly
    ? serviceIds.length === 1
      ? `Export “${serviceName(serviceIds[0])}”`
      : `Export ${serviceIds.length} services`
    : samplesOnly
      ? isSingle
        ? `Export “${sampleTitle(sampleIds[0])}”`
        : `Export ${sampleIds.length} samples`
      : `Export ${selectionCount} items`

  const description = servicesOnly
    ? `Build a self-contained copy of Demo Studio with only the selected service${serviceIds.length === 1 ? '' : 's'} and no samples.`
    : `Build a self-contained copy of Demo Studio with only the selected ${samplesOnly ? `sample${isSingle ? '' : 's'}` : 'samples and services'} and the services they depend on.`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        {/* Gradient header strip */}
        <div className="from-primary/10 via-secondary/5 relative bg-gradient-to-br to-transparent px-6 pt-6 pb-5">
          <div className="sidebar-brand-stripe absolute inset-x-0 top-0 h-0.5" />
          <DialogHeader className="space-y-2">
            <DialogTitle className="flex items-center gap-2.5 text-base">
              <span className="bg-primary/10 ring-primary/15 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1">
                <Package className="text-primary h-5 w-5" />
              </span>
              <span className="truncate">{title}</span>
            </DialogTitle>
            <DialogDescription className="leading-relaxed">
              {description}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-5 px-6 pt-1 pb-5">
          {/* Selected samples */}
          {sampleIds.length > 0 && (
            <div className="space-y-2">
              <p className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium tracking-wider uppercase">
                <Layers className="h-3.5 w-3.5" />
                Sample{isSingle ? '' : 's'}
                <span className="text-muted-foreground/60 normal-case">
                  ({sampleIds.length})
                </span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {sampleIds.map((id) => (
                  <Badge key={id} variant="secondary" className="text-[11px]">
                    {sampleTitle(id)}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Directly selected services */}
          {serviceIds.length > 0 && (
            <div className="space-y-2">
              <p className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium tracking-wider uppercase">
                <Server className="h-3.5 w-3.5" />
                Service{serviceIds.length === 1 ? '' : 's'}
                <span className="text-muted-foreground/60 normal-case">
                  ({serviceIds.length})
                </span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {serviceIds.map((id) => (
                  <Badge key={id} variant="secondary" className="text-[11px]">
                    {serviceName(id)}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Optional toggle */}
          <label
            className={cn(
              'border-border bg-muted/30 hover:border-primary/40 flex cursor-pointer items-start justify-between gap-4 rounded-xl border p-3.5 transition-colors',
              includeOptional && 'border-primary/40 bg-primary/5',
            )}
          >
            <div className="space-y-0.5">
              <span className="text-foreground text-sm font-medium">
                Include optional services
              </span>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Adds optional dependencies for the full demo experience. Leave
                off for the slimmest bundle.
              </p>
            </div>
            <Switch
              checked={includeOptional}
              onCheckedChange={setIncludeOptional}
              disabled={planLoading || exporting}
              className="mt-0.5 shrink-0"
            />
          </label>

          {/* Plan preview */}
          <div className="space-y-2">
            <p className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium tracking-wider uppercase">
              <Server className="h-3.5 w-3.5" />
              Included services
            </p>

            {planError ? (
              <div
                role="alert"
                className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2.5 rounded-xl border p-3.5 text-sm"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="leading-relaxed">{planError}</span>
              </div>
            ) : planLoading && !plan ? (
              <div className="border-border/60 bg-muted/20 text-muted-foreground flex items-center gap-2.5 rounded-xl border border-dashed p-3.5 text-sm">
                <Loader2 className="text-primary h-4 w-4 animate-spin" />
                Resolving dependencies…
              </div>
            ) : plan ? (
              <div className="border-border/60 bg-muted/15 overflow-hidden rounded-xl border">
                <ScrollArea className="max-h-56">
                  <div
                    className={cn(
                      'space-y-3.5 p-3.5 transition-opacity duration-200',
                      planLoading && 'opacity-50',
                    )}
                  >
                    <ServiceGroup
                      label="Required"
                      ids={plan.services.required}
                      dotClass="bg-primary"
                    />
                    {declaredOptional.length > 0 && (
                      <ServiceGroup
                        label="Optional"
                        ids={declaredOptional}
                        dotClass="bg-info"
                      />
                    )}
                    {additional.length > 0 && (
                      <ServiceGroup
                        label="Also required by shared code"
                        ids={additional}
                        dotClass="bg-muted-foreground/60"
                      />
                    )}
                  </div>
                </ScrollArea>
                <div className="border-border/60 bg-muted/30 text-muted-foreground flex items-center gap-4 border-t px-3.5 py-2.5 text-xs">
                  <span className="flex items-center gap-1.5">
                    <Server className="h-3.5 w-3.5" />
                    <span className="text-foreground font-medium tabular-nums">
                      {plan.services.included.length}
                    </span>
                    service
                    {plan.services.included.length !== 1 && 's'}
                  </span>
                  <span className="bg-border h-3 w-px" />
                  <span className="flex items-center gap-1.5">
                    <Boxes className="h-3.5 w-3.5" />
                    <span className="text-foreground font-medium tabular-nums">
                      {plan.workers.length}
                    </span>
                    worker
                    {plan.workers.length !== 1 && 's'}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="border-border/60 bg-muted/20 border-t px-6 py-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={exporting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={exporting || planLoading || !!planError || !plan}
            className="gap-2"
          >
            {exporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Exporting…
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Export &amp; download
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ServiceGroup({
  label,
  ids,
  dotClass,
}: {
  label: string
  ids: string[]
  dotClass: string
}) {
  if (ids.length === 0) return null
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium">
        <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} />
        {label}
        <span className="text-muted-foreground/50 tabular-nums">
          {ids.length}
        </span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {ids.map((id) => (
          <div
            key={id}
            className="border-border/50 bg-background/60 flex items-center gap-1.5 rounded-md border px-2 py-1"
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} />
            <span className="text-foreground/80 text-[11px]">
              {serviceName(id)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

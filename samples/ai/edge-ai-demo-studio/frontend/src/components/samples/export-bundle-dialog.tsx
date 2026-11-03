// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Layers,
  Loader,
  type LucideIcon,
  Package,
  RotateCcw,
  Server,
  X,
} from 'lucide-react'
import { InlineNotice } from '@/components/common/inline-notice'
import { TruncatedText } from '@/components/common/truncated-text'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { getSampleById } from '@/samples/registry'
import { DialogHeroHeader } from './dialog-hero-header'
import { type ExportRun, formatExpiry } from './export-bundle-store'
import {
  ExportSectionLabel,
  PlanPreview,
  serviceName,
} from './export-plan-preview'
import { type ExportPhase, useExportBundle } from './hooks/use-export-bundle'

/** The steps the progress bar counts; `starting` comes before the first. */
const PHASE_STEPS: { phase: ExportPhase; label: string }[] = [
  { phase: 'planning', label: 'Resolving the export plan' },
  { phase: 'copying', label: 'Copying files' },
  { phase: 'codegen', label: 'Generating registries' },
]

interface ExportBundleDialogProps {
  sampleIds: string[]
  /** Services to export directly — may be used alone with no samples. */
  serviceIds?: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called when an export finishes, and its download starts, while open. */
  onExported?: () => void
}

function sampleTitle(id: string): string {
  return getSampleById(id)?.title ?? id
}

/** The dialog's title and description for a selection of samples and/or services. */
function exportCopy(
  sampleIds: string[],
  serviceIds: string[],
): { title: string; description: string; subject: string } {
  const s = (count: number) => (count === 1 ? '' : 's')
  if (sampleIds.length === 0) {
    const subject =
      serviceIds.length === 1
        ? serviceName(serviceIds[0])
        : `${serviceIds.length} services`
    return {
      title:
        serviceIds.length === 1 ? `Export “${subject}”` : `Export ${subject}`,
      description: `Build a self-contained copy of Demo Studio with only the selected service${s(serviceIds.length)} and no samples.`,
      subject,
    }
  }
  const samplesOnly = serviceIds.length === 0
  const subject = !samplesOnly
    ? `${sampleIds.length + serviceIds.length} items`
    : sampleIds.length === 1
      ? sampleTitle(sampleIds[0])
      : `${sampleIds.length} samples`
  return {
    title:
      samplesOnly && sampleIds.length === 1
        ? `Export “${subject}”`
        : `Export ${subject}`,
    description: `Build a self-contained copy of Demo Studio with only the selected ${samplesOnly ? `sample${s(sampleIds.length)}` : 'samples and services'} and the services they depend on.`,
    subject,
  }
}

/**
 * Builds and downloads a bundle of the selection. The export outlives the dialog
 * (`export-bundle-store`): only Cancel export stops it.
 */
export function ExportBundleDialog({
  sampleIds,
  serviceIds = [],
  open,
  onOpenChange,
  onExported,
}: ExportBundleDialogProps) {
  const { title, description, subject } = exportCopy(sampleIds, serviceIds)
  const exportBundle = useExportBundle({
    sampleIds,
    serviceIds,
    title: subject,
    open,
    onExported: () => {
      onExported?.()
      onOpenChange(false)
    },
  })
  const { plan, planLoading, planError, exporting, run, includeOptional } =
    exportBundle

  const handleOpenChange = (next: boolean) => {
    if (!next) exportBundle.close()
    onOpenChange(next)
  }

  // A finished bundle built with the options shown downloads again as is.
  const ready = run?.phase === 'done' && run.includeOptional === includeOptional

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        <DialogHeroHeader
          icon={Package}
          title={title}
          description={description}
        />

        <div className="space-y-5 px-6 pt-1 pb-5">
          <SelectionGroup
            icon={Layers}
            noun="Sample"
            items={sampleIds.map((id) => ({ id, name: sampleTitle(id) }))}
          />
          <SelectionGroup
            icon={Server}
            noun="Service"
            items={serviceIds.map((id) => ({ id, name: serviceName(id) }))}
          />

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
              onCheckedChange={exportBundle.setIncludeOptional}
              disabled={planLoading || exporting}
              className="mt-0.5 shrink-0"
            />
          </label>

          <PlanPreview
            plan={plan}
            loading={planLoading}
            error={planError}
            onRetry={exportBundle.refetchPlan}
          />

          {run && (
            <ExportRunPanel
              run={run}
              optionsChanged={run.includeOptional !== includeOptional}
              onCancel={exportBundle.cancelExport}
              onDownload={exportBundle.download}
              onRebuild={exportBundle.startExport}
            />
          )}
        </div>

        <DialogFooter className="border-border/60 bg-muted/20 border-t px-6 py-4">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            data-testid="export-close-button"
          >
            Close
          </Button>
          {ready ? (
            <Button
              onClick={exportBundle.download}
              className="gap-2"
              data-testid="export-download-button"
            >
              <Download className="h-4 w-4" aria-hidden />
              Download again
            </Button>
          ) : (
            <Button
              onClick={exportBundle.startExport}
              disabled={exporting || planLoading || !!planError || !plan}
              aria-busy={exporting || undefined}
              className="gap-2"
              data-testid="export-start-button"
            >
              {exporting ? (
                <Loader className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Download className="h-4 w-4" aria-hidden />
              )}
              <span className="stable-label">
                <span className={cn(exporting && 'invisible')}>
                  Export &amp; download
                </span>
                <span className={cn(!exporting && 'invisible')}>
                  Building bundle…
                </span>
              </span>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SelectionGroup({
  icon,
  noun,
  items,
}: {
  icon: LucideIcon
  noun: string
  items: { id: string; name: string }[]
}) {
  if (items.length === 0) return null
  return (
    <div className="space-y-2">
      <ExportSectionLabel icon={icon}>
        {noun}
        {items.length === 1 ? '' : 's'}
        <span className="text-muted-foreground/60 normal-case">
          ({items.length})
        </span>
      </ExportSectionLabel>
      <div className="flex flex-wrap gap-1.5">
        {items.map(({ id, name }) => (
          <Badge key={id} variant="secondary" className="text-xs">
            {name}
          </Badge>
        ))}
      </div>
    </div>
  )
}

/** The selection's latest export: building, ready, or how it ended. */
function ExportRunPanel({
  run,
  optionsChanged,
  onCancel,
  onDownload,
  onRebuild,
}: {
  run: ExportRun
  /** The options toggle no longer matches what this export was built with. */
  optionsChanged: boolean
  onCancel: () => void
  onDownload: () => void
  onRebuild: () => void
}) {
  switch (run.phase) {
    case 'running':
      return <ExportProgressPanel run={run} onCancel={onCancel} />
    case 'done':
      return (
        <ExportReadyPanel
          run={run}
          optionsChanged={optionsChanged}
          onDownload={onDownload}
          onRebuild={onRebuild}
        />
      )
    case 'failed':
      return (
        <InlineNotice
          tone="destructive"
          size="sm"
          data-testid="export-status"
          icon={<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
        >
          <span className="font-medium">Export failed.</span>{' '}
          {run.error ?? 'The bundle was not built.'} Export &amp; download tries
          again.
        </InlineNotice>
      )
    case 'cancelled':
      return (
        <p
          role="status"
          data-testid="export-status"
          className="text-muted-foreground border-border bg-muted/30 rounded-lg border px-3 py-2 text-xs"
        >
          Export cancelled: nothing was downloaded, and the server removed what
          it had built.
        </p>
      )
    case 'interrupted':
      return (
        <InlineNotice
          tone="warning"
          size="sm"
          role="status"
          data-testid="export-status"
        >
          The last export of this selection stopped when the page was reloaded
          or closed, so nothing was downloaded. Export &amp; download builds it
          again.
        </InlineNotice>
      )
    case 'expired':
      return (
        <InlineNotice
          tone="warning"
          size="sm"
          role="status"
          data-testid="export-status"
        >
          The finished bundle is no longer on the server: bundles are kept for
          30 minutes. Export &amp; download builds it again.
        </InlineNotice>
      )
  }
}

function ExportProgressPanel({
  run,
  onCancel,
}: {
  run: ExportRun
  onCancel: () => void
}) {
  const { progress, cancelling } = run
  const currentStep = progress
    ? PHASE_STEPS.findIndex((step) => step.phase === progress.phase)
    : -1
  const label = cancelling
    ? 'Cancelling the export'
    : currentStep >= 0
      ? PHASE_STEPS[currentStep].label
      : 'Preparing bundle'

  return (
    <div
      data-testid="export-progress"
      className="border-primary/30 bg-primary/5 space-y-2.5 rounded-xl border p-3.5"
    >
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2.5 text-sm"
      >
        <Loader
          className="text-primary h-4 w-4 shrink-0 animate-spin"
          aria-hidden
        />
        <span className="text-foreground font-medium">{label}…</span>
        {currentStep >= 0 && !cancelling && (
          <span className="text-muted-foreground ml-auto text-xs tabular-nums">
            Step {currentStep + 1} of {PHASE_STEPS.length}
          </span>
        )}
      </div>
      <Progress
        // Indeterminate until the first step starts.
        value={
          currentStep >= 0 && !cancelling
            ? ((currentStep + 1) / PHASE_STEPS.length) * 100
            : null
        }
        aria-label="Export progress"
        className="h-1"
      />
      {progress && !cancelling && (
        <TruncatedText
          text={progress.message}
          className="text-muted-foreground block font-mono text-xs"
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground min-w-0 flex-1 text-xs">
          You can close this dialog: the export keeps going, and its download
          starts when the bundle is ready.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={cancelling}
          className="hover:text-destructive hover:border-destructive/50 shrink-0 gap-1.5"
          data-testid="export-cancel-button"
        >
          {cancelling ? (
            <Loader className="animate-spin" aria-hidden />
          ) : (
            <X aria-hidden />
          )}
          {cancelling ? 'Cancelling…' : 'Cancel export'}
        </Button>
      </div>
    </div>
  )
}

function ExportReadyPanel({
  run,
  optionsChanged,
  onDownload,
  onRebuild,
}: {
  run: ExportRun
  optionsChanged: boolean
  onDownload: () => void
  onRebuild: () => void
}) {
  const { download } = run
  if (!download) return null
  return (
    <div
      role="status"
      data-testid="export-ready"
      className="border-success/30 bg-success/5 space-y-2 rounded-xl border p-3.5"
    >
      <div className="flex items-center gap-2.5 text-sm">
        <CheckCircle2 className="text-success h-4 w-4 shrink-0" aria-hidden />
        <span className="text-foreground font-medium">Bundle ready</span>
      </div>
      <TruncatedText
        text={download.fileName}
        className="text-foreground block font-mono text-xs"
      />
      <p className="text-muted-foreground text-xs">
        {optionsChanged
          ? `Built ${run.includeOptional ? 'with' : 'without'} optional services. `
          : ''}
        Downloads again without rebuilding until{' '}
        {formatExpiry(download.expiresAt)}.
      </p>
      <div className="flex flex-wrap gap-2">
        {optionsChanged && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDownload}
            className="gap-1.5"
          >
            <Download aria-hidden />
            Download this bundle
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRebuild}
          className="gap-1.5"
          data-testid="export-rebuild-button"
        >
          <RotateCcw aria-hidden />
          Build a new bundle
        </Button>
      </div>
    </div>
  )
}

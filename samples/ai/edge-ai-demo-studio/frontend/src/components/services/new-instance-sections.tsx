// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Info, Loader, TriangleAlert } from 'lucide-react'
import { InlineNotice } from '@/components/common/inline-notice'
import { TruncatedText } from '@/components/common/truncated-text'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SheetFooter } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { getServiceMetadata } from '@/lib/instances/service-metadata'
import { instanceRuntime } from '@/lib/instances/service-presentation'
import { cn } from '@/lib/utils'
import type { ServiceInstance } from '@/services/types'
import { FactRow } from './fact-row'
import type { describeNewInstanceProblem } from './new-instance-copy'
import type { DraftSummaryRow } from './new-instance-summary'

/** Characters that fit a summary value even in a phone-wide sheet. */
const SHORT_VALUE = 24

/**
 * A fact's value. Only a long one uses `TruncatedText` (a tab stop), so tabbing to Create does not
 * stop on every short word.
 */
export function FactValue({ text, mono }: { text: string; mono?: boolean }) {
  if (text.length <= SHORT_VALUE) {
    return <span className={cn(mono && 'font-mono')}>{text}</span>
  }
  return (
    <TruncatedText
      text={text}
      className={cn('ml-auto w-fit max-w-full', mono && 'font-mono')}
    />
  )
}

/** "Copy settings from": the source instance, what it runs, and a shared-GPU note. */
export function CopySettingsSection({
  instances,
  copyFrom,
  onCopyFromChange,
  source,
  deviceInUse,
  device,
  canConfigure,
}: {
  instances: ServiceInstance[]
  /** Instance id of the source. */
  copyFrom: string
  onCopyFromChange: (instanceId: string) => void
  source: ServiceInstance
  /** A running instance already on the source's GPU. */
  deviceInUse: ServiceInstance | undefined
  device: string
  /** Recommended settings are on offer as the way to another device. */
  canConfigure: boolean
}) {
  const runtime = instanceRuntime(source)
  const { cpuAffinity } = getServiceMetadata(source)
  return (
    <div className="space-y-2">
      <Label
        htmlFor="new-instance-copy-from"
        className="text-muted-foreground text-xs"
      >
        Copy settings from
      </Label>
      <Select value={copyFrom} onValueChange={onCopyFromChange}>
        <SelectTrigger
          id="new-instance-copy-from"
          data-testid="new-instance-copy-from"
          className="w-full"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {instances.map((i) => (
            <SelectItem key={i.instanceKey} value={i.instanceId}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {(runtime.model ||
        runtime.device ||
        source.currentBackend ||
        cpuAffinity) && (
        <dl className="bg-muted/30 space-y-2 rounded-lg border px-3 py-2.5">
          {/* A service without a model (a vector store) has neither row. */}
          {runtime.model && (
            <FactRow
              size="xs"
              label="Model"
              value={<FactValue text={runtime.model} mono />}
            />
          )}
          {runtime.device && (
            <FactRow
              size="xs"
              label="Device"
              value={<FactValue text={runtime.device} />}
            />
          )}
          {source.currentBackend && (
            <FactRow
              size="xs"
              label="Backend"
              value={<FactValue text={source.currentBackend} />}
            />
          )}
          {cpuAffinity && (
            <FactRow
              size="xs"
              label="CPU affinity"
              value={<FactValue text={cpuAffinity} />}
            />
          )}
        </dl>
      )}
      <p className="text-muted-foreground text-xs">
        Every setting is copied. Downloaded models are shared, so one another
        instance already uses is not fetched again.
      </p>
      {deviceInUse && (
        <InlineNotice
          tone="info"
          size="sm"
          className="items-start"
          icon={
            <Info
              aria-hidden="true"
              className="text-info mt-0.5 h-3.5 w-3.5 shrink-0"
            />
          }
        >
          “{deviceInUse.label}” already runs on {device}. The two instances
          would share that GPU&apos;s memory
          {canConfigure
            ? ' — choose Recommended settings to pick another device.'
            : '.'}
        </InlineNotice>
      )}
    </div>
  )
}

/** "You're adding": the name, what it will run with, what happens next, and what it fetches. */
export function CreationSummary({
  verb,
  label,
  rows,
  autostart,
  firstStart,
}: {
  verb: string
  label: string
  rows: DraftSummaryRow[]
  autostart: boolean
  /** What the first start downloads or sets up, when known. */
  firstStart?: { text: string; fetches: boolean }
}) {
  return (
    <div
      className="bg-muted/30 rounded-lg border px-3.5 py-3"
      data-testid="new-instance-summary"
    >
      <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
        You&apos;re {verb}
      </p>
      <dl className="space-y-2">
        <FactRow
          size="xs"
          label="Name"
          value={<FactValue text={label.trim() || 'Not named yet'} />}
        />
        {rows.map((row) => (
          <FactRow
            key={row.label}
            size="xs"
            label={row.label}
            value={<FactValue text={row.value} mono={row.mono} />}
          />
        ))}
        <FactRow
          size="xs"
          label="Then"
          value={
            <FactValue
              text={autostart ? 'Starts right away' : 'Stays stopped'}
            />
          }
        />
      </dl>
      {firstStart && (
        <p
          className="text-muted-foreground mt-2.5 text-xs leading-relaxed"
          data-testid="new-instance-first-start"
        >
          {firstStart.text}
          {autostart && firstStart.fetches && ' Its page shows the progress.'}
        </p>
      )}
    </div>
  )
}

/**
 * The sheet footer. The problem line is Create's description, so it is read with the button. While
 * Create is in flight it cannot be called back, so Cancel becomes Close and autostart is fixed.
 */
export function NewInstanceFooter({
  problem,
  problemId,
  onReview,
  autostart,
  onAutostartChange,
  autostartLabel,
  onCancel,
  canSubmit,
  submitting,
  submitLabel,
  pendingLabel,
  pendingNote,
  onSubmit,
}: {
  problem: ReturnType<typeof describeNewInstanceProblem>
  problemId: string
  /** Opens the settings at the field in error. */
  onReview: () => void
  autostart: boolean
  onAutostartChange: (autostart: boolean) => void
  autostartLabel: string
  onCancel: () => void
  canSubmit: boolean
  submitting: boolean
  submitLabel: string
  pendingLabel: string
  pendingNote: string
  onSubmit: () => void
}) {
  const { message, waiting, reviewable } = problem
  return (
    <SheetFooter className="border-border gap-3 border-t px-5 py-3">
      {submitting && (
        <p
          role="status"
          className="text-muted-foreground flex items-center gap-2 text-xs"
          data-testid="new-instance-pending"
        >
          <Loader
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 animate-spin"
          />
          {pendingNote}
        </p>
      )}
      {!submitting && message && (
        <div
          id={problemId}
          role="status"
          className={cn(
            'flex flex-wrap items-center gap-x-2 gap-y-1 text-xs',
            waiting ? 'text-muted-foreground' : 'text-destructive',
          )}
          data-testid="new-instance-problem"
        >
          {waiting ? (
            <Loader
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 animate-spin"
            />
          ) : (
            <TriangleAlert
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0"
            />
          )}
          <span className="min-w-0 flex-1">{message}</span>
          {reviewable && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={onReview}
            >
              Review settings
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label
          className={cn(
            'flex items-center gap-2 text-sm',
            submitting ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
          )}
        >
          <Switch
            checked={autostart}
            onCheckedChange={onAutostartChange}
            aria-label={autostartLabel}
            disabled={submitting}
          />
          {autostartLabel}
        </label>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            data-testid="new-instance-cancel"
          >
            {submitting ? 'Close' : 'Cancel'}
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="new-instance-create"
            disabled={!canSubmit || submitting}
            aria-describedby={message ? problemId : undefined}
            onClick={onSubmit}
            className={cn(submitting && 'cursor-progress')}
          >
            {submitting ? (
              <>
                <Loader
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin"
                />
                {pendingLabel}
              </>
            ) : (
              submitLabel
            )}
          </Button>
        </div>
      </div>
    </SheetFooter>
  )
}

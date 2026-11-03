// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertTriangle, CircleCheck, RotateCcw, Settings2 } from 'lucide-react'
import { useOpenConfigure } from '@/components/configure/configure-opener'
import { TruncatedText } from '@/components/common/truncated-text'
import { Button } from '@/components/ui/button'
import { useServiceToggle } from '@/hooks/use-service-toggle'
import type { Service } from '@/services/types'
import type { LogEntry, LogRun } from '../hooks/use-log'
import { errorHeadline, formatLogTime } from '../log-message'

/** Retry and Edit settings, for an instance whose start failed. */
function FailedStartActions({ serviceKey }: { serviceKey: string }) {
  const { pending, run } = useServiceToggle(serviceKey)
  const openConfigure = useOpenConfigure()
  return (
    <>
      <Button
        type="button"
        size="sm"
        className="h-8"
        onClick={run}
        disabled={pending}
        aria-busy={pending || undefined}
        data-testid="log-summary-retry"
      >
        <RotateCcw aria-hidden="true" className="size-3.5" />
        Retry
      </Button>
      {openConfigure && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          onClick={openConfigure}
          data-testid="log-summary-edit-settings"
        >
          <Settings2 aria-hidden="true" className="size-3.5" />
          Edit settings
        </Button>
      )}
    </>
  )
}

/**
 * Above the raw lines: the run's error count and latest error, a way to show only errors, and why
 * a failed start failed, with Retry and Edit settings.
 */
export function LogSummary({
  service,
  retained,
  run,
  showingErrors,
  onShowErrors,
}: {
  service: Service
  /** Every entry the view retains, before filtering. */
  retained: LogEntry[]
  run: LogRun
  /** The level filter already shows errors only. */
  showingErrors: boolean
  onShowErrors: () => void
}) {
  const errors = retained.filter((entry) => entry.level === 'ERROR')
  const latest = errors.at(-1)
  const failed = run === 'current' && service.status === 'error'
  const count = `${errors.length} ${errors.length === 1 ? 'error' : 'errors'}`

  if (!failed && retained.length === 0) return null
  return (
    <div
      className="border-border space-y-2 border-b px-3 py-2.5 text-xs sm:px-4"
      data-testid="log-summary"
    >
      {failed && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-2"
          data-testid="log-summary-failed"
        >
          <p className="text-destructive flex min-w-0 flex-1 basis-56 items-center gap-1.5 font-medium">
            <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="min-w-0">
              Failed to start
              {service.statusMessage ? `: ${service.statusMessage}` : ''}
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <FailedStartActions
              serviceKey={service.instanceKey ?? service.id}
            />
          </div>
        </div>
      )}
      {retained.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <span
            className={
              errors.length > 0
                ? 'text-destructive flex shrink-0 items-center gap-1.5 font-semibold'
                : 'text-muted-foreground flex shrink-0 items-center gap-1.5'
            }
            data-testid="log-error-count"
          >
            {errors.length > 0 ? (
              <AlertTriangle aria-hidden="true" className="size-3.5" />
            ) : (
              <CircleCheck aria-hidden="true" className="size-3.5" />
            )}
            {errors.length > 0 ? count : 'No errors in the latest entries'}
          </span>
          {latest && (
            <span className="flex min-w-0 flex-1 basis-48 items-center gap-1.5">
              <span className="text-muted-foreground shrink-0">
                Latest {formatLogTime(latest.timestamp)}:
              </span>
              <TruncatedText
                text={errorHeadline(latest.message)}
                className="text-foreground font-mono"
                data-testid="log-latest-error"
              />
            </span>
          )}
          {errors.length > 0 && !showingErrors && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 px-2 text-xs"
              onClick={onShowErrors}
              data-testid="log-show-errors"
            >
              Show only errors
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

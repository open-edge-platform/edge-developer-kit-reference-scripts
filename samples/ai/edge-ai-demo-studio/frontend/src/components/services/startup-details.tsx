// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { CircleAlert } from 'lucide-react'
import Link from 'next/link'
import { TruncatedText } from '@/components/common/truncated-text'
import { Button } from '@/components/ui/button'
import type {
  StartupProgress,
  StartupTelemetry,
} from '@/lib/instances/runtime-fields'
import { serviceHref } from '@/lib/instances/service-presentation'
import {
  describeStartupStep,
  formatStartupProgress,
  STARTUP_STAGE_LABEL,
  startupProgressPercent,
} from '@/lib/instances/startup-presentation'
import { cn } from '@/lib/utils'
import { HREF_CHARS, safeHref } from '@/lib/validation'
import { sourceParam } from '@/services/common/logs/log-filter-params'
import type { Service } from '@/services/types'

/**
 * Startup step and failure details (`StartupTelemetry`) for the startup notices. Only what was
 * reported appears. Everything renders inline, so it can sit in a notice's description paragraph.
 */

/**
 * The startup report, only while starting: before a retry reaches the server the row still carries
 * the failed attempt, whose progress must not show as the new start's.
 */
export function liveStartup(
  service: Pick<Service, 'status' | 'startup'>,
): StartupTelemetry | undefined {
  return service.status === 'starting' ? service.startup : undefined
}

/**
 * A bar with a reported total, the amount alone without one. The visible figures are hidden from
 * screen readers, so the surrounding status region only speaks when the step changes.
 */
function StartupProgressMeter({
  progress,
  label,
}: {
  progress: StartupProgress
  label: string
}) {
  const percent = startupProgressPercent(progress)
  const text = formatStartupProgress(progress)
  return (
    <span
      role="progressbar"
      aria-label={`${label} progress`}
      aria-valuemin={percent === undefined ? undefined : 0}
      aria-valuemax={percent === undefined ? undefined : 100}
      aria-valuenow={percent}
      aria-valuetext={text}
      className="mt-1.5 block max-w-sm"
      data-testid="startup-progress"
      data-total={progress.total === undefined ? 'unknown' : 'known'}
    >
      {percent !== undefined && (
        <span
          aria-hidden="true"
          className="bg-muted block h-1.5 overflow-hidden rounded-full"
        >
          <span
            className="bg-primary block h-full rounded-full transition-[width] motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </span>
      )}
      <span
        aria-hidden="true"
        className="text-muted-foreground mt-1 block text-xs tabular-nums"
      >
        {text}
      </span>
    </span>
  )
}

/** "Downloading model.bin" with its progress; nothing when no step was reported. */
export function StartupStep({
  startup,
  className,
}: {
  startup: StartupTelemetry | undefined
  className?: string
}) {
  if (!startup?.stage) return null
  const label = STARTUP_STAGE_LABEL[startup.stage]
  return (
    <span
      className={cn('mt-2 block', className)}
      data-testid="startup-step"
      data-stage={startup.stage}
      data-attempt={startup.attemptId}
    >
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="text-foreground shrink-0 font-medium">{label}</span>
        {startup.detail && (
          <TruncatedText
            text={startup.detail}
            className="text-muted-foreground"
            data-testid="startup-step-detail"
          />
        )}
      </span>
      {startup.progress && (
        <StartupProgressMeter progress={startup.progress} label={label} />
      )}
    </span>
  )
}

/** A failed start: the reported summary, the app's reason, and the step it stopped in. */
export function StartupFailureDescription({
  statusMessage,
  startup,
  fallback,
}: {
  statusMessage: string | undefined
  startup: StartupTelemetry | undefined
  fallback: string
}) {
  const failure = startup?.failure
  const step = startup?.stage ? describeStartupStep(startup) : undefined
  if (!failure && !step) return <>{statusMessage ?? fallback}</>
  const progress = startup?.progress
    ? ` · ${formatStartupProgress(startup.progress)}`
    : ''
  return (
    <>
      <span
        className="text-foreground block break-words"
        data-testid="startup-failure-summary"
      >
        {failure?.summary ?? statusMessage ?? fallback}
      </span>
      {failure && statusMessage && (
        <span className="mt-0.5 block break-words">{statusMessage}</span>
      )}
      {step && (
        <span
          className="mt-0.5 block text-xs break-words"
          data-testid="startup-failure-step"
        >
          Last step: {step}
          {progress}
        </span>
      )}
    </>
  )
}

/**
 * The instance's Logs tab filtered to errors, and to the log with the startup error when shown.
 * `undefined` without a reported failure.
 */
export function startupErrorsHref(
  service: Pick<Service, 'id' | 'instanceId' | 'startup' | 'logSources'>,
): string | undefined {
  const failure = service.startup?.failure
  if (!failure) return undefined
  const source = failure.source
    ? (sourceParam(failure.source, service.logSources) ?? undefined)
    : undefined
  return serviceHref(service.id, {
    instanceId: service.instanceId,
    tab: 'logs',
    logLevel: 'ERROR',
    logSource: source,
  })
}

export function ViewErrorsLink({
  service,
}: {
  service: Pick<Service, 'id' | 'instanceId' | 'startup' | 'logSources'>
}) {
  const errorsHref = startupErrorsHref(service)
  if (!errorsHref) return null
  let href = ''
  for (const ch of safeHref(errorsHref)) {
    let ok = ''
    for (const allowed of HREF_CHARS)
      if (allowed === ch) {
        ok = allowed
        break
      }
    if (!ok) {
      href = '/'
      break
    }
    href += ok
  }
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={href} data-testid="startup-view-errors">
        <CircleAlert aria-hidden="true" className="h-3.5 w-3.5" />
        View errors
      </Link>
    </Button>
  )
}

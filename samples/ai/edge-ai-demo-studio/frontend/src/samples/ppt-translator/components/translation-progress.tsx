// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  Ban,
  CheckCircle,
  Clock,
  FileText,
  Loader,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { InlineNotice } from '@/components/common/inline-notice'
import { TONES, type Tone } from '@/components/common/tones'
import { TruncatedText } from '@/components/common/truncated-text'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type {
  TranslationJob,
  TranslationJobRun,
} from '../hooks/use-translation-job'
import { TranslationActions } from './translation-actions'

interface TranslationProgressProps {
  job: TranslationJobRun
  /** Start a new job with the same file (after a failure or a cancel). */
  onRetry: () => void
  /** Back to the upload, for another file. */
  onReset: () => void
}

const STATUS_META: Record<
  TranslationJob['status'],
  { icon: LucideIcon; tone: Tone; badgeLabel: string; title: string }
> = {
  pending: {
    icon: Clock,
    tone: 'warning',
    badgeLabel: 'Queued',
    title: 'Waiting for the translation worker',
  },
  processing: {
    icon: Loader,
    tone: 'primary',
    badgeLabel: 'Translating…',
    title: 'Translating your slides',
  },
  completed: {
    icon: CheckCircle,
    tone: 'success',
    badgeLabel: 'Completed',
    title: 'Translation finished',
  },
  failed: {
    icon: XCircle,
    tone: 'destructive',
    badgeLabel: 'Failed',
    title: 'Translation failed',
  },
  cancelled: {
    icon: Ban,
    tone: 'muted',
    badgeLabel: 'Cancelled',
    title: 'Translation cancelled',
  },
}

/** A job the worker no longer has (it restarted): neither failed nor done. */
const GONE_META: (typeof STATUS_META)[TranslationJob['status']] = {
  icon: XCircle,
  tone: 'muted',
  badgeLabel: 'Unavailable',
  title: 'This translation is no longer available',
}

/** The job's status word, once the worker has reported where it is. */
function displayStatus(
  job: TranslationJobRun,
): TranslationJob['status'] | null {
  switch (job.phase) {
    case 'queued':
      return 'pending'
    case 'running':
      return job.status ? 'processing' : null
    case 'done':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    default:
      return null
  }
}

/**
 * The job from acceptance to download, with cancel while it runs and retry after it fails. A job
 * resumed after a reload has lost its file, so retrying means choosing the file again.
 */
export function TranslationProgress({
  job,
  onRetry,
  onReset,
}: TranslationProgressProps) {
  const status = displayStatus(job)
  const meta = status ? (job.gone ? GONE_META : STATUS_META[status]) : null
  const report = job.status
  const fileKept = job.input !== null
  const retryHint = fileKept
    ? 'Your file and settings are kept: Translate again starts a new job with the same file.'
    : 'To translate it again, choose the file again with Translate another file.'

  return (
    <section
      aria-labelledby="ppt-status-heading"
      className="surface-panel rounded-xl p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2
            id="ppt-status-heading"
            className="text-foreground text-lg font-semibold"
          >
            Translation Status
          </h2>
          <SubmittedSummary job={job} />
        </div>
        <div data-testid="translation-status-badge" className="shrink-0">
          {meta ? (
            <Badge variant="outline" tone={meta.tone}>
              {status === 'processing' && (
                <Loader className="animate-spin" aria-hidden />
              )}
              {meta.badgeLabel}
            </Badge>
          ) : (
            <Skeleton className="h-5 w-20 rounded-full" />
          )}
        </div>
      </div>

      {job.resumed && !job.gone && (
        <InlineNotice
          tone="info"
          size="sm"
          role="status"
          className="mt-4"
          data-testid="translation-resumed-notice"
        >
          This is the translation you started before leaving the page. It kept
          running on the worker while you were away.
        </InlineNotice>
      )}

      {!meta ? (
        <div className="mt-6 space-y-3" aria-busy="true">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-2 w-full rounded-full" />
        </div>
      ) : (
        <>
          <div className="mt-6 flex items-start gap-3">
            <meta.icon
              className={cn(
                'mt-0.5 h-6 w-6 shrink-0',
                TONES[meta.tone].text,
                status === 'processing' && 'animate-spin',
              )}
              aria-hidden
            />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-foreground text-sm font-medium">
                {meta.title}
              </p>
              {status !== 'failed' && report?.message && (
                <p className="text-muted-foreground text-sm">
                  {report.message}
                </p>
              )}
            </div>
          </div>

          {(status === 'pending' || status === 'processing') && (
            <ProgressReadout
              queued={status === 'pending'}
              progress={report?.progress ?? 0}
            />
          )}

          {status === 'failed' && (
            <InlineNotice
              tone="destructive"
              size="sm"
              className="mt-5"
              data-testid="translation-failed-notice"
            >
              {job.error?.message ?? 'The translation did not finish.'}{' '}
              {retryHint}
            </InlineNotice>
          )}

          {status === 'cancelled' && (
            <p className="text-muted-foreground mt-5 text-xs">{retryHint}</p>
          )}

          {report?.created_at && (
            <p className="text-muted-foreground mt-5 text-xs">
              Started {new Date(report.created_at).toLocaleString()}
              {report.completed_at &&
                ` · Finished ${new Date(report.completed_at).toLocaleString()}`}
            </p>
          )}
        </>
      )}

      <TranslationActions job={job} onRetry={onRetry} onReset={onReset} />
    </section>
  )
}

/** What was submitted, kept on screen while the job runs. */
function SubmittedSummary({ job }: { job: TranslationJobRun }) {
  const fileName = job.input?.file.name ?? job.saved?.fileName
  const params = job.input?.params ?? job.saved?.params
  return (
    <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {fileName && (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <TruncatedText
            text={fileName}
            className="text-foreground max-w-[240px] font-medium"
          />
        </span>
      )}
      {params && (
        <span>
          {params.sourceLanguage} → {params.targetLanguage}
        </span>
      )}
      {job.jobId && (
        <span data-testid="job-id" className="font-mono">
          Job ID: {job.jobId}
        </span>
      )}
    </p>
  )
}

function ProgressReadout({
  queued,
  progress,
}: {
  queued: boolean
  progress: number
}) {
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100)
  return (
    <div className="mt-5 space-y-2" role="status" aria-live="polite">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">
          {queued
            ? 'Queued · progress appears once translation starts'
            : 'Progress reported by the translation job'}
        </span>
        <span className="text-foreground font-medium tabular-nums">
          {percent}%
        </span>
      </div>
      <Progress
        data-testid="translation-progress-bar"
        value={percent}
        aria-label="Translation progress"
      />
    </div>
  )
}

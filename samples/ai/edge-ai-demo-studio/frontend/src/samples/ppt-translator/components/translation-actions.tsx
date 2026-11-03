// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Download, FileText, Loader, RotateCcw, X } from 'lucide-react'
import { InlineNotice } from '@/components/common/inline-notice'
import { Button } from '@/components/ui/button'
import { useDownload } from '../hooks/use-download'
import type { TranslationJobRun } from '../hooks/use-translation-job'

interface TranslationActionsProps {
  job: TranslationJobRun
  onRetry: () => void
  onReset: () => void
}

/**
 * The job's actions for its phase: download when done, cancel while running, retry after a
 * failure or cancel, and back to the upload once over.
 */
export function TranslationActions({
  job,
  onRetry,
  onReset,
}: TranslationActionsProps) {
  const download = useDownload()
  const { jobId, phase, cancelling } = job
  const inProgress = phase === 'queued' || phase === 'running'
  const finished =
    phase === 'done' || phase === 'failed' || phase === 'cancelled'

  return (
    <>
      {download.isError && jobId && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <InlineNotice tone="destructive" size="sm" className="flex-1">
            Download failed. {download.error.message}
          </InlineNotice>
          <Button
            variant="outline"
            size="sm"
            onClick={() => download.mutate(jobId)}
            disabled={download.isPending}
          >
            Retry download
          </Button>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        {phase === 'done' && jobId && (
          <Button
            data-testid="download-button"
            onClick={() => download.mutate(jobId)}
            disabled={download.isPending}
            aria-busy={download.isPending || undefined}
            className="gap-2 sm:flex-1"
            size="lg"
          >
            {download.isPending ? (
              <Loader className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Download className="h-4 w-4" aria-hidden />
            )}
            {download.isPending
              ? 'Preparing download…'
              : 'Download translated file'}
          </Button>
        )}
        {inProgress && (
          <Button
            data-testid="cancel-translation-button"
            onClick={job.cancel}
            disabled={cancelling}
            aria-busy={cancelling || undefined}
            variant="outline"
            className="gap-2 sm:flex-1"
            size="lg"
          >
            {cancelling ? (
              <Loader className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <X className="h-4 w-4" aria-hidden />
            )}
            {cancelling ? 'Cancelling…' : 'Cancel translation'}
          </Button>
        )}
        {(phase === 'failed' || phase === 'cancelled') && job.input && (
          <Button onClick={onRetry} className="gap-2 sm:flex-1" size="lg">
            <RotateCcw className="h-4 w-4" aria-hidden />
            Translate again
          </Button>
        )}
        {finished && (
          <Button
            data-testid="translate-another-button"
            onClick={onReset}
            variant="outline"
            className="gap-2 sm:flex-1"
            size="lg"
          >
            <FileText className="h-4 w-4" aria-hidden />
            Translate another file
          </Button>
        )}
      </div>
    </>
  )
}

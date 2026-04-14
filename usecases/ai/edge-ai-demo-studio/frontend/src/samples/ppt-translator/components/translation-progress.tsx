// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect } from 'react'
import {
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  Download,
  RotateCcw,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslationStatus } from '../hooks'
import { useDownload } from '../hooks'
import type { TranslationJob } from '../hooks'

interface TranslationProgressProps {
  jobId: string
  onReset: () => void
  onComplete?: () => void
}

function StatusIcon({ status }: { status: TranslationJob['status'] }) {
  switch (status) {
    case 'pending':
      return <Clock className="h-12 w-12 text-yellow-500" />
    case 'processing':
      return <Loader2 className="h-12 w-12 animate-spin text-blue-500" />
    case 'completed':
      return <CheckCircle className="h-12 w-12 text-green-500" />
    case 'failed':
      return <XCircle className="h-12 w-12 text-red-500" />
  }
}

function StatusBadge({ status }: { status: TranslationJob['status'] }) {
  switch (status) {
    case 'pending':
      return (
        <Badge
          variant="secondary"
          className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200"
        >
          Queued
        </Badge>
      )
    case 'processing':
      return (
        <Badge
          variant="secondary"
          className="bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-200"
        >
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          Translating...
        </Badge>
      )
    case 'completed':
      return (
        <Badge
          variant="secondary"
          className="bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-200"
        >
          Completed
        </Badge>
      )
    case 'failed':
      return <Badge variant="destructive">Failed</Badge>
  }
}

export function TranslationProgress({
  jobId,
  onReset,
  onComplete,
}: TranslationProgressProps) {
  const { data: job, isLoading } = useTranslationStatus(jobId)
  const download = useDownload()

  useEffect(() => {
    if (job?.status === 'completed') {
      onComplete?.()
    }
  }, [job?.status, onComplete])

  if (isLoading || !job) {
    return (
      <Card>
        <CardContent className="space-y-4 py-12">
          <Skeleton className="mx-auto h-12 w-12 rounded-full" />
          <Skeleton className="mx-auto h-4 w-48" />
          <Skeleton className="h-3 w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Translation Status</CardTitle>
          <div data-testid="translation-status-badge">
            <StatusBadge status={job.status} />
          </div>
        </div>
        <CardDescription data-testid="job-id">
          Job ID: {job.job_id}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col items-center space-y-4 py-6">
          <StatusIcon status={job.status} />
          <p className="text-muted-foreground max-w-md text-center">
            {job.message}
          </p>
        </div>

        {(job.status === 'processing' || job.status === 'pending') && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">
                {Math.round(job.progress * 100)}%
              </span>
            </div>
            <div
              data-testid="translation-progress-bar"
              className="bg-muted h-3 w-full overflow-hidden rounded-full"
            >
              <div
                className="bg-primary h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.round(job.progress * 100)}%` }}
              />
            </div>
          </div>
        )}

        {job.status === 'failed' && job.error && (
          <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-lg border p-4">
            <p className="flex items-center gap-2 font-medium">
              <XCircle className="h-4 w-4 flex-shrink-0" />
              Error Details
            </p>
            <p className="mt-1 text-sm">{job.error}</p>
          </div>
        )}

        {download.isError && (
          <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-lg border p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <XCircle className="h-4 w-4 flex-shrink-0" />
              Download failed. Please try again.
            </p>
          </div>
        )}

        <div className="bg-muted rounded-lg p-4">
          <div className="text-muted-foreground space-y-1 text-xs">
            <p>Created: {new Date(job.created_at).toLocaleString()}</p>
            {job.completed_at && (
              <p>Completed: {new Date(job.completed_at).toLocaleString()}</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          {job.status === 'completed' && (
            <Button
              data-testid="download-button"
              onClick={() => download.mutate(jobId)}
              disabled={download.isPending}
              className="flex-1"
              size="lg"
            >
              {download.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Downloading...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Download Translated File
                </>
              )}
            </Button>
          )}

          {(job.status === 'completed' || job.status === 'failed') && (
            <Button
              data-testid="translate-another-button"
              onClick={onReset}
              variant="outline"
              className="flex-1"
              size="lg"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Translate Another
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

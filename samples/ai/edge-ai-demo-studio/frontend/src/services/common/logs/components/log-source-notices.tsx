// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertTriangle } from 'lucide-react'
import { InlineNotice } from '@/components/common/inline-notice'
import { Button } from '@/components/ui/button'
import type { SourceProblem } from '../hooks/use-log'

/** Above the lines: sources not read now and, when only some reads failed, which ones, with Retry. */
export function LogSourceNotices({
  unavailableSources,
  failedSources,
  partialFailure,
  onRetry,
}: {
  unavailableSources: SourceProblem[]
  failedSources: SourceProblem[]
  /** Some source reads failed, not all of them. */
  partialFailure: boolean
  onRetry: () => void
}) {
  return (
    <>
      {unavailableSources.length > 0 && (
        <p
          className="text-muted-foreground border-border border-b px-4 py-2 text-xs"
          data-testid="log-unavailable-sources"
        >
          {unavailableSources
            .map((s) => `${s.label} logs: ${s.message}`)
            .join(' · ')}
        </p>
      )}

      {partialFailure && (
        <InlineNotice
          tone="warning"
          size="sm"
          icon={<AlertTriangle aria-hidden className="size-3.5 shrink-0" />}
          className="rounded-none border-0 border-b py-2"
        >
          <span data-testid="log-partial-failure">
            {failedSources.map((s) => s.label).join(', ')} logs are unavailable
            · {failedSources.map((s) => s.message).join('; ')}
          </span>{' '}
          <Button
            variant="link"
            size="xs"
            className="h-auto px-1 text-xs"
            onClick={onRetry}
          >
            Retry
          </Button>
        </InlineNotice>
      )}
    </>
  )
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Check, CheckCircle2, Link2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import type { Service } from '@/services/types'
import { DemoStatePanel } from './demo-state-panel'

/** Shown once when a start watched on this page becomes healthy: it is ready, and its API URL. */
export function ReadyNotice({
  service,
  onDismiss,
}: {
  service: Service
  onDismiss: () => void
}) {
  const { copied, copy } = useCopyToClipboard()
  const { apiBase } = service
  return (
    <DemoStatePanel
      icon={CheckCircle2}
      tone="success"
      title={`${service.label ?? service.name} is ready`}
      description={
        apiBase && (
          <>
            Its API answers at{' '}
            <code className="text-foreground font-mono text-xs break-all">
              {apiBase}
            </code>
            .
          </>
        )
      }
      testId="demo-state-ready"
    >
      {apiBase && (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void copy(`${window.location.origin}${apiBase}`)}
          >
            {copied ? (
              <Check className="text-success h-3.5 w-3.5" />
            ) : (
              <Link2 className="h-3.5 w-3.5" />
            )}
            Copy API URL
          </Button>
          <span role="status" className="sr-only">
            {copied ? 'API URL copied' : ''}
          </span>
        </>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <X />
      </Button>
    </DemoStatePanel>
  )
}

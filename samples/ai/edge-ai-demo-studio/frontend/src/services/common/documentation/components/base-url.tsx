// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

/** Where the instance's API answers, with a copy button; with no instance, what examples use instead. */
export function BaseUrl({ value }: { value?: string }) {
  const { copied, copy } = useCopyToClipboard()
  return (
    <div className="border-primary/15 bg-primary/5 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
      <span className="text-primary text-xs font-semibold">Base URL</span>
      {value ? (
        <>
          <code className="text-foreground min-w-0 flex-1 font-mono text-xs [overflow-wrap:anywhere]">
            {value}
          </code>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy base URL"
            onClick={() => void copy(value)}
          >
            {copied ? <Check className="text-success" /> : <Copy />}
          </Button>
          <span role="status" className="sr-only">
            {copied ? 'Base URL copied' : ''}
          </span>
        </>
      ) : (
        <p className="text-muted-foreground text-xs">
          Add an instance to get its URL. Code examples use &lt;instance-id&gt;.
        </p>
      )}
    </div>
  )
}

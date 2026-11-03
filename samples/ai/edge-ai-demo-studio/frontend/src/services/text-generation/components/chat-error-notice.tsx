// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { AlertCircle, RotateCcw } from 'lucide-react'
import { InlineNotice } from '@/components/common/inline-notice'
import { Button } from '@/components/ui/button'
import { describeChatError } from '../lib/chat-helpers'

/** A failed response, inline in the conversation, with Retry when offered. */
export function ChatErrorNotice({
  error,
  onRetry,
  retryDisabled,
}: {
  error: Error
  onRetry?: () => void
  retryDisabled?: boolean
}) {
  return (
    <InlineNotice
      tone="destructive"
      size="sm"
      data-testid="chat-error"
      className="items-start"
      icon={<AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />}
      action={
        onRetry && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={retryDisabled}
            onClick={onRetry}
          >
            <RotateCcw aria-hidden className="h-3.5 w-3.5" />
            Retry
          </Button>
        )
      }
    >
      <span className="block font-medium">Response failed</span>
      <span className="text-muted-foreground line-clamp-3 block break-words">
        {describeChatError(error)}
      </span>
    </InlineNotice>
  )
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Check, Copy, Link2 } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { TruncatedText } from '@/components/common/truncated-text'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

const emptySubscribe = () => () => {}

/**
 * The instance's API base as a toolbar badge: shows the path only (the origin is the page's),
 * while Copy copies the absolute URL. Nothing for an instance without an HTTP address.
 */
export function ApiAddress({ apiBase }: { apiBase: string }) {
  const origin = useSyncExternalStore(
    emptySubscribe,
    () => window.location.origin,
    () => '',
  )
  const { copied, copy } = useCopyToClipboard()
  if (!origin || !apiBase) return null
  const url = `${origin}${apiBase}`

  return (
    <Badge
      tone="muted"
      className="h-7 max-w-full min-w-0 gap-1.5 rounded-md pr-0.5 pl-2.5 text-xs sm:max-w-[20rem]"
      data-testid="service-api-address"
    >
      <Link2 aria-hidden="true" className="h-3 w-3 shrink-0" />
      <span className="shrink-0 font-normal opacity-75">API</span>
      <TruncatedText
        text={apiBase}
        className="font-mono"
        data-testid="service-api-url"
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-6 w-6 shrink-0"
            aria-label={copied ? 'API address copied' : 'Copy API address'}
            onClick={() => void copy(url)}
          >
            {copied ? (
              <Check aria-hidden="true" className="text-success h-3.5 w-3.5" />
            ) : (
              <Copy aria-hidden="true" className="h-3.5 w-3.5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[min(90vw,32rem)] break-all">
          {copied ? 'Copied' : 'Copy'} <span className="font-mono">{url}</span>
        </TooltipContent>
      </Tooltip>
    </Badge>
  )
}

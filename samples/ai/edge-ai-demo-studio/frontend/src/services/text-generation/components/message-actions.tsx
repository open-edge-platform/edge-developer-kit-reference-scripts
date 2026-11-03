// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertTriangle, Check, Copy, Square, Volume2 } from 'lucide-react'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { cn } from '@/lib/utils'
import type { MessageOutcome } from '../lib/chat-helpers'

const ACTION_CLASS =
  'text-muted-foreground hover:text-foreground flex min-h-7 w-fit items-center gap-1 rounded px-1 text-xs transition-colors'

const OUTCOME_LABEL: Record<MessageOutcome, string> = {
  stopped: 'Stopped',
  interrupted: 'Interrupted',
}

/** How a response ended early: "Stopped" by the user, or "Interrupted". */
export function OutcomeLabel({ outcome }: { outcome: MessageOutcome }) {
  const Icon = outcome === 'stopped' ? Square : AlertTriangle
  return (
    <span
      data-testid="message-outcome"
      className={cn(
        'flex items-center gap-1 px-1 text-xs',
        outcome === 'stopped' ? 'text-muted-foreground' : 'text-warning',
      )}
    >
      <Icon aria-hidden className="h-3 w-3" />
      {OUTCOME_LABEL[outcome]}
    </span>
  )
}

export function CopyMessageButton({ text }: { text: string }) {
  const { copied, copy } = useCopyToClipboard()
  return (
    <button
      type="button"
      onClick={() => void copy(text)}
      className={ACTION_CLASS}
    >
      {copied ? (
        <Check aria-hidden className="h-3 w-3" />
      ) : (
        <Copy aria-hidden className="h-3 w-3" />
      )}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

/** Reads the message aloud; `onToggle` also stops it while it is read or synthesized. */
export function SpeakButton({
  speaking,
  onToggle,
}: {
  speaking: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(ACTION_CLASS, speaking && 'text-primary')}
    >
      {speaking ? (
        <Square aria-hidden className="h-3 w-3 fill-current" />
      ) : (
        <Volume2 aria-hidden className="h-3 w-3" />
      )}
      {speaking ? 'Stop reading' : 'Listen'}
    </button>
  )
}

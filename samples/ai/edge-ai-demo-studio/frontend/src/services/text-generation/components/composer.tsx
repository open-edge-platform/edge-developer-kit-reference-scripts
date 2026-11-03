// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ArrowUp, Square } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { handleChatKeyDown } from '../lib/chat-helpers'

interface ComposerProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  input: string
  onInputChange: (value: string) => void
  /** Sends the draft; Enter sends too, Shift+Enter starts a new line. */
  onSend: () => void
  /** Offered instead of Send while a response is generated. */
  onStop?: () => void
  isRunning: boolean
  /** The draft cannot be edited. */
  disabled?: boolean
  /** The draft can be edited but not sent. */
  sendDisabled?: boolean
  placeholder: string
  rows: number
  /** Controls above the input, e.g. Voice and Image. */
  toolbar?: ReactNode
  /** Shown inside the input frame above the text, e.g. attached images. */
  inputExtra?: ReactNode
}

/** The message input at the foot of a conversation, with Send or Stop. */
export function Composer({
  textareaRef,
  input,
  onInputChange,
  onSend,
  onStop,
  isRunning,
  disabled,
  sendDisabled,
  placeholder,
  rows,
  toolbar,
  inputExtra,
}: ComposerProps) {
  const send = () => {
    if (!isRunning && !sendDisabled) onSend()
  }

  return (
    <div className="border-border border-t p-3">
      {toolbar && (
        <div className="mb-2 flex items-center gap-1.5">{toolbar}</div>
      )}

      <div className="bg-muted/30 border-input focus-within:border-ring focus-within:ring-ring/50 rounded-md border shadow-xs focus-within:ring-[3px]">
        {inputExtra && <div className="px-3 pt-2">{inputExtra}</div>}
        <div className="flex items-end gap-2 pr-1.5 pb-1">
          <Textarea
            ref={textareaRef}
            data-testid="chat-input"
            aria-label="Message"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => handleChatKeyDown(e, send)}
            placeholder={placeholder}
            disabled={disabled}
            rows={rows}
            className="field-sizing-fixed !min-h-9 flex-1 resize-none border-none text-sm shadow-none focus-visible:ring-0"
          />
          {isRunning && onStop ? (
            <Button
              onClick={onStop}
              size="sm"
              variant="outline"
              aria-label="Stop generating"
              className="mb-0.5 h-7 shrink-0 gap-1.5 px-2.5 text-xs"
              data-testid="stop-chat-button"
            >
              <Square
                aria-hidden
                className="text-destructive h-3 w-3 fill-current"
              />
            </Button>
          ) : (
            <Button
              onClick={send}
              size="icon"
              aria-label="Send message"
              disabled={disabled || sendDisabled || !input.trim() || isRunning}
              data-testid="send-chat-button"
              className="mb-0.5 h-7 w-7 shrink-0"
            >
              <ArrowUp aria-hidden className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

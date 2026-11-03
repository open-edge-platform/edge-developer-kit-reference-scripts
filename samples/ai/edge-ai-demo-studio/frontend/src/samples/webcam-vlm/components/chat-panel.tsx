// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Camera, X } from 'lucide-react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { ConversationPanel } from '@/services/text-generation/components/conversation-panel'
import type { useTextGenChat } from '@/services/text-generation/hooks/use-chat'

interface ChatPanelProps {
  chat: ReturnType<typeof useTextGenChat>
  /** Sends the draft with the frame. */
  onSend: () => void
  /** Clears the conversation and the captured frame. */
  onReset: () => void
  disabled?: boolean
  captureImage: () => string | null
  webcamReady: boolean
  capturedPreview: string | null
  onCapturedPreviewChange: (preview: string | null) => void
  placeholder: string
  emptyStateText: string
  examplePrompts?: string[]
  sttOnline?: boolean
  ttsOnline?: boolean
}

/**
 * The conversation beside the camera preview. A captured frame sits in the composer until sent, so
 * it is clear which picture goes with the question; without one, a frame is captured at send time.
 */
export function ChatPanel({
  chat,
  onSend,
  onReset,
  disabled,
  captureImage,
  webcamReady,
  capturedPreview,
  onCapturedPreviewChange,
  placeholder,
  emptyStateText,
  examplePrompts,
  sttOnline,
  ttsOnline,
}: ChatPanelProps) {
  const handleCapture = () => {
    const dataUrl = captureImage()
    if (dataUrl) onCapturedPreviewChange(dataUrl)
  }

  return (
    <ConversationPanel
      messages={chat.messages}
      status={chat.status}
      input={chat.input}
      onInputChange={chat.setInput}
      onSend={onSend}
      onStop={chat.handleStop}
      onReset={onReset}
      error={chat.error}
      onRetry={chat.handleRetry}
      disabled={disabled}
      sttOnline={sttOnline}
      ttsOnline={ttsOnline}
      placeholder={placeholder}
      emptyStateText={emptyStateText}
      examplePrompts={examplePrompts}
      className="h-full max-h-[max(200px,min(70vh,calc(100dvh_-_232px)))] min-h-0"
      messagesClassName="max-h-[520px]"
      inputExtra={
        capturedPreview ? (
          <div className="relative mb-2 inline-flex items-end gap-2">
            <Image
              src={capturedPreview}
              alt="Captured frame that will be sent with your question"
              width={64}
              height={64}
              className="border-border h-16 w-16 rounded-lg border object-cover"
              unoptimized
            />
            <span className="text-muted-foreground mb-1 text-[11px]">
              Sent with your next question
            </span>
            <button
              type="button"
              aria-label="Remove captured frame"
              className="bg-destructive text-destructive-foreground absolute -top-1.5 -left-1.5 flex h-5 w-5 items-center justify-center rounded-full"
              onClick={() => onCapturedPreviewChange(null)}
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </div>
        ) : undefined
      }
      toolbarExtra={
        webcamReady ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground h-7 gap-1.5 px-2 text-xs"
            onClick={handleCapture}
            disabled={disabled || chat.isRunning}
          >
            <Camera className="h-3.5 w-3.5" aria-hidden />
            {capturedPreview ? 'Capture again' : 'Capture frame'}
          </Button>
        ) : undefined
      }
    />
  )
}

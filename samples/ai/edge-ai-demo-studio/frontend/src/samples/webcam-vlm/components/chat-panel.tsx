// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Camera, X } from 'lucide-react'
import Image from 'next/image'
import { useCallback } from 'react'
import { Button } from '@/components/ui/button'
import type {
  ChatMsg,
  ChatStatus,
} from '@/services/text-generation/components/chat-helpers'
import { ConversationPanel } from '@/services/text-generation/components/conversation-panel'

interface ChatPanelProps {
  messages: ChatMsg[]
  status: ChatStatus
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onReset: () => void
  disabled?: boolean
  captureImage: () => string | null
  webcamReady: boolean
  capturedPreview: string | null
  onCapturedPreviewChange: (preview: string | null) => void
  sttOnline?: boolean
  ttsOnline?: boolean
  ttsVoice?: string
  ttsSpeed?: number
}

export function ChatPanel({
  messages,
  status,
  input,
  onInputChange,
  onSend,
  onReset,
  disabled,
  captureImage,
  webcamReady,
  capturedPreview,
  onCapturedPreviewChange,
  sttOnline,
  ttsOnline,
  ttsVoice,
  ttsSpeed,
}: ChatPanelProps) {
  const handleCapture = useCallback(() => {
    const dataUrl = captureImage()
    if (dataUrl) onCapturedPreviewChange(dataUrl)
  }, [captureImage, onCapturedPreviewChange])

  const isRunning = status === 'submitted' || status === 'streaming'

  return (
    <ConversationPanel
      messages={messages}
      status={status}
      input={input}
      onInputChange={onInputChange}
      onSend={onSend}
      onReset={onReset}
      disabled={disabled}
      sttOnline={sttOnline}
      ttsOnline={ttsOnline}
      ttsVoice={ttsVoice}
      ttsSpeed={ttsSpeed}
      placeholder={
        webcamReady
          ? 'Ask about what you see…'
          : 'Connect webcam to get started…'
      }
      emptyStateText={
        webcamReady
          ? 'Capture an image and ask a question about it'
          : 'Connect your webcam to get started'
      }
      messagesClassName="max-h-[480px] min-h-[320px]"
      inputExtra={
        capturedPreview ? (
          <div className="relative mb-2 inline-block">
            <Image
              src={capturedPreview}
              alt="Captured frame"
              width={64}
              height={64}
              className="border-border h-16 w-16 rounded-lg border object-cover"
              unoptimized
            />
            <button
              type="button"
              className="bg-destructive absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full"
              onClick={() => onCapturedPreviewChange(null)}
            >
              <X className="text-destructive-foreground h-3 w-3" />
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
            disabled={disabled || isRunning}
          >
            <Camera className="h-3.5 w-3.5" />
            Capture
          </Button>
        ) : undefined
      }
    />
  )
}

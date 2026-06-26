// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ImagePlus, X } from 'lucide-react'
import Image from 'next/image'
import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import type {
  ChatMsg,
  ChatStatus,
} from '@/services/text-generation/components/chat-helpers'
import { ConversationPanel } from '@/services/text-generation/components/conversation-panel'

const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif'

interface ChatPanelProps {
  messages: ChatMsg[]
  status: ChatStatus
  hasKnowledgeBase: boolean
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onReset: () => void
  sttOnline?: boolean
  ttsOnline?: boolean
  ttsVoice?: string
  ttsSpeed?: number
  isVlm?: boolean
  imagePreview?: string | null
  onImageSelect?: (e: React.ChangeEvent<HTMLInputElement>) => void
  onImageRemove?: () => void
}

export function ChatPanel({
  messages,
  status,
  hasKnowledgeBase,
  input,
  onInputChange,
  onSend,
  onReset,
  sttOnline,
  ttsOnline,
  ttsVoice,
  ttsSpeed,
  isVlm,
  imagePreview,
  onImageSelect,
  onImageRemove,
}: ChatPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isRunning = status === 'submitted' || status === 'streaming'

  return (
    <>
      {isVlm && (
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          className="hidden"
          onClick={(e) => {
            ;(e.target as HTMLInputElement).value = ''
          }}
          onChange={onImageSelect}
        />
      )}
      <ConversationPanel
        messages={messages}
        status={status}
        input={input}
        onInputChange={onInputChange}
        onSend={onSend}
        onReset={onReset}
        sttOnline={sttOnline}
        ttsOnline={ttsOnline}
        ttsVoice={ttsVoice}
        ttsSpeed={ttsSpeed}
        inputExtra={
          imagePreview ? (
            <div className="relative mb-2 inline-block">
              <Image
                src={imagePreview}
                alt="Attached"
                width={64}
                height={64}
                className="border-border h-16 w-16 rounded-lg border object-cover"
                unoptimized
              />
              <button
                type="button"
                className="bg-destructive absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full"
                onClick={onImageRemove}
              >
                <X className="text-destructive-foreground h-3 w-3" />
              </button>
            </div>
          ) : undefined
        }
        toolbarExtra={
          isVlm ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground h-7 gap-1.5 px-2 text-xs"
              onClick={() => fileInputRef.current?.click()}
              disabled={!hasKnowledgeBase || isRunning}
            >
              <ImagePlus className="h-3.5 w-3.5" />
              Image
            </Button>
          ) : undefined
        }
        placeholder={
          !hasKnowledgeBase
            ? 'Set up a knowledge base first…'
            : 'Ask a question about your documents…'
        }
        emptyStateText={
          hasKnowledgeBase
            ? 'Ask a question about your documents'
            : 'Select a knowledge base and upload documents to start'
        }
        messagesClassName="max-h-[480px] min-h-[320px]"
      />
    </>
  )
}

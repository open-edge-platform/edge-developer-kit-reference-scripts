// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { SlidersHorizontal, X } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/lib/utils'
import { DemoParameterSidebar } from '@/services/common/demo/components/demo-parameter-sidebar'
import { useDemoRuntime } from '@/services/common/demo/demo-runtime'
import { demoStateKey } from '@/services/common/demo/demo-session'
import type { Service } from '@/services/types'
import { ConversationPanel } from './components/conversation-panel'
import { useTextGenChat } from './hooks/use-chat'
import { useTextGenParams } from './hooks/use-params'

/** Wide enough (Tailwind `xl`) for parameters beside the conversation. */
const WIDE_QUERY = '(min-width: 80rem)'

const EXAMPLE_PROMPTS = [
  'What is OpenVINO',
  'What is an Intel NPU',
  'Summarize the pros and cons of NPU vs GPU for AI inference',
]

/** Grows with the viewport between a usable minimum and a readable maximum. */
const CONVERSATION_HEIGHT = 'h-[clamp(320px,calc(100dvh-20rem),820px)]'

export function TextGenerationDemo({ service }: { service: Service }) {
  const isMultimodal = service.currentModelType === 'multimodal'
  // Conversation, draft and settings are kept per instance while the service page is open.
  const instanceKey = service.instanceKey
  const {
    values: textGenValues,
    requestParams,
    params,
    customCount,
    resetParams,
  } = useTextGenParams(undefined, {
    sessionKey: demoStateKey(service, 'params'),
  })
  const extraBody = instanceKey ? { instanceKey } : undefined
  const chat = useTextGenChat({
    textGenValues,
    requestParams,
    extraBody,
    sessionKey: instanceKey,
  })

  // While the instance is unavailable the conversation and draft stay usable; only sending waits.
  const { available } = useDemoRuntime()
  const [paramsOpen, setParamsOpen] = useState(false)
  const isWide = useMediaQuery(WIDE_QUERY)

  const sidebar = (variant: 'card' | 'plain') => (
    <DemoParameterSidebar
      params={params}
      onReset={resetParams}
      resetDisabled={customCount === 0}
      variant={variant}
      headerActions={
        variant === 'card' ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close parameters"
            className="h-8 w-8"
            onClick={() => setParamsOpen(false)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : undefined
      }
    />
  )

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <ConversationPanel
        messages={chat.messages}
        status={chat.status}
        error={chat.error}
        onRetry={chat.handleRetry}
        input={chat.input}
        onInputChange={chat.setInput}
        onSend={chat.handleSend}
        onStop={chat.handleStop}
        onReset={chat.handleReset}
        sendDisabled={!available}
        attachments={chat.attachments}
        allowImageAttach={isMultimodal}
        placeholder={
          isMultimodal
            ? 'Ask about the image or type a message…'
            : 'Type a message…'
        }
        emptyStateText="Enter a message"
        examplePrompts={EXAMPLE_PROMPTS}
        headerActions={
          <Button
            variant={paramsOpen ? 'secondary' : 'ghost'}
            size="sm"
            aria-expanded={paramsOpen}
            onClick={() => setParamsOpen(!paramsOpen)}
            className="h-8 gap-1.5 px-2 text-xs"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Parameters
            {customCount > 0 && (
              <Badge
                tone="primary"
                className="h-4 min-w-4 px-1 text-xs tabular-nums"
              >
                {customCount}
                <span className="sr-only"> custom</span>
              </Badge>
            )}
          </Button>
        }
        className={cn(CONVERSATION_HEIGHT, 'min-w-0 flex-1')}
      />
      {isWide && paramsOpen && (
        <aside
          aria-label="Parameters"
          className={cn(CONVERSATION_HEIGHT, 'w-72 shrink-0 overflow-y-auto')}
        >
          {sidebar('card')}
        </aside>
      )}
      <Sheet open={!isWide && paramsOpen} onOpenChange={setParamsOpen}>
        <SheetContent
          aria-describedby={undefined}
          // Focus the sheet, not its first control, whose tooltip would cover the title.
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            if (e.currentTarget instanceof HTMLElement) e.currentTarget.focus()
          }}
          className="overflow-y-auto"
        >
          <SheetHeader className="pb-0">
            <SheetTitle>Parameters</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">{sidebar('plain')}</div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

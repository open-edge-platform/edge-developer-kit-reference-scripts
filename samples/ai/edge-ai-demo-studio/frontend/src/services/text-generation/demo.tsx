// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { DemoParameterSidebar } from '@/services/common/demo/components/demo-parameter-sidebar'
import type { Service } from '@/services/types'
import { VlmChatPanel } from './components/vlm-chat-panel'
import { useTextGenChat } from './hooks/use-chat'
import { useTextGenParams } from './hooks/use-params'

export function TextGenerationDemo({ service }: { service: Service }) {
  const isMultimodal = service.currentModelType === 'multimodal'
  const { values: textGenValues, params } = useTextGenParams()
  const chat = useTextGenChat({ textGenValues })

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <VlmChatPanel
        messages={chat.messages}
        status={chat.status}
        input={chat.input}
        onInputChange={chat.setInput}
        onSend={chat.handleSend}
        onStop={chat.handleStop}
        onReset={chat.handleReset}
        isVlm={isMultimodal}
        imagePreview={chat.imagePreview}
        onImageSelect={chat.handleImageSelect}
        onImageRemove={chat.handleRemoveImage}
        placeholder={
          isMultimodal
            ? 'Ask about the image or type a message…'
            : 'Type a message…'
        }
        emptyStateText="Send a message to start the conversation"
        messagesClassName="max-h-[480px] min-h-[320px]"
        className="min-w-0 flex-1"
      />
      <div className="shrink-0 space-y-4 xl:w-72">
        <DemoParameterSidebar params={params} />
      </div>
    </div>
  )
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMemo } from 'react'
import { useGetService } from '@/context/service-status-context'
import {
  useMcpParams,
  useOptionalServiceGroup,
  useRagParams,
  useTextGenerationParams,
  useTtsParams,
} from '@/samples/common/hooks'
import { useTextGenChat } from '@/services/text-generation/hooks'
import type { Sample } from '../types'
import { ChatArea } from './components/chat-area'
import { KnowledgeBasePanel } from './components/knowledge-base-panel'
import { SampleParamsSlot } from '../common/sample-params-slot'

export function RagChatbotDemo({ sample }: { sample: Sample }) {
  const textGen = useTextGenerationParams()
  const tts = useTtsParams(sample.id)

  const stt = useOptionalServiceGroup({
    serviceId: 'speech-to-text',
    serviceLabel: 'Speech to Text',
    offlineMessage:
      'Enable STT for voice input. Start the service from the services page.',
  })

  const mcp = useMcpParams()
  const rag = useRagParams()

  const textGenService = useGetService('text-generation')
  const isMultimodal = textGenService?.currentModelType === 'multimodal'

  const hasKnowledgeBase = rag.selectedKb != null && rag.vectordbOnline

  const extraBody = useMemo(
    () => ({
      ...rag.extraBody,
      ...(mcp.enabled && mcp.selectedServerIds.length > 0
        ? { mcpServerIds: mcp.selectedServerIds }
        : {}),
    }),
    [rag.extraBody, mcp.enabled, mcp.selectedServerIds],
  )

  const chat = useTextGenChat({
    textGenValues: textGen.values,
    extraBody,
  })

  return (
    <div className="space-y-4">
      <SampleParamsSlot
        groups={[textGen.group, tts.group, stt.group, ...rag.groups, mcp.group]}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <KnowledgeBasePanel
          selectedKb={rag.selectedKb}
          onSelectKb={rag.onSelectKb}
          embeddingsOnline={rag.embeddingsOnline}
          embeddingPort={rag.embeddingPort}
          embeddingModelName={rag.embeddingModelName}
          rerankPort={rag.rerankPort}
          rerankModelName={rag.rerankModelName}
        />
        <ChatArea
          messages={chat.messages}
          status={chat.status}
          hasKnowledgeBase={hasKnowledgeBase}
          input={chat.input}
          onInputChange={chat.setInput}
          onSend={chat.handleSend}
          onReset={chat.handleReset}
          sttOnline={stt.enabled}
          ttsOnline={tts.online}
          ttsVoice={tts.values.voice}
          ttsSpeed={tts.values.speed}
          isVlm={isMultimodal}
          imagePreview={chat.imagePreview}
          onImageSelect={chat.handleImageSelect}
          onImageRemove={chat.handleRemoveImage}
        />
      </div>
    </div>
  )
}

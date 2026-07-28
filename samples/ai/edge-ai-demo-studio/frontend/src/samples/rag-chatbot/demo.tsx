// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMemo } from 'react'
import { useGetService } from '@/context/service-status-context'
import type { ServiceParamGroup } from '@/samples/common/components/demo-config-sheet'
import { useFeatureCollector } from '@/context/feature-collector'
import {
  FeatureContexts,
  sttOnlineFromExports,
  ttsOnlineFromExports,
} from '@/samples/common/feature-providers/feature-contexts'
import { useFeatureProviders } from '@/samples/common/feature-providers/use-feature-providers'
import { useTextGenerationParams } from '@/samples/common/hooks/use-text-generation-params'
import { useRagParams } from '@/services/vectordb/hooks/use-rag-params'
import { useTextGenChat } from '@/services/text-generation/hooks/use-chat'
import type { Sample } from '../types'
import { ChatPanel } from './components/chat-panel'
import { KnowledgeBasePanel } from './components/knowledge-base-panel'
import { SampleParamsSlot } from '../common/sample-params-slot'

// Optional-service feature integrations this sample wires (explicit opt-in).
// vectordb + embeddings are REQUIRED here, so RAG stays a direct hook (its
// KnowledgeBasePanel renders as a column, not in the config sheet).
// See docs/OPTIONAL-SERVICES.md.
const FEATURE_SERVICES = ['text-to-speech', 'speech-to-text', 'mcp']

export function RagChatbotDemo({ sample }: { sample: Sample }) {
  const textGen = useTextGenerationParams({
    systemPromptTooltip:
      'Optional. Add {context} where you want the retrieved knowledge-base context inserted. If you omit {context}, the context is appended to the end of your prompt.',
  })
  const rag = useRagParams()

  const featureProviders = useFeatureProviders(FEATURE_SERVICES)
  const collector = useFeatureCollector(FEATURE_SERVICES)
  const sttOnline = sttOnlineFromExports(collector.exports)
  const ttsOnline = ttsOnlineFromExports(collector.exports)

  const textGenService = useGetService('text-generation')
  const isMultimodal = textGenService?.currentModelType === 'multimodal'

  const hasKnowledgeBase = rag.selectedKb != null && rag.vectordbOnline

  const extraBody = useMemo(
    () => ({ ...rag.extraBody, ...collector.extraBody }),
    [rag.extraBody, collector.extraBody],
  )

  const chat = useTextGenChat({
    textGenValues: textGen.values,
    requestParams: textGen.requestParams,
    extraBody,
  })

  // Preserve the original Configure-sheet order: textGen, tts, stt, then RAG
  // (vectordb, rerank), then mcp. tts/stt/mcp come from the collector.
  const collectorGroup = (id: string) =>
    collector.groups.find((g) => g.serviceId === id)
  const groups = [
    textGen.group,
    collectorGroup('text-to-speech'),
    collectorGroup('speech-to-text'),
    ...rag.groups,
    collectorGroup('mcp'),
  ].filter((g): g is ServiceParamGroup => g != null)

  return (
    <div className="space-y-4">
      <collector.Provider>
        {featureProviders.map(({ serviceId, Provider }) => (
          <Provider
            key={serviceId}
            onTranscription={chat.setInput}
            sampleId={sample.id}
          />
        ))}
      </collector.Provider>

      <SampleParamsSlot groups={groups} />

      <FeatureContexts exports={collector.exports}>
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
          <ChatPanel
            messages={chat.messages}
            status={chat.status}
            hasKnowledgeBase={hasKnowledgeBase}
            input={chat.input}
            onInputChange={chat.setInput}
            onSend={chat.handleSend}
            onReset={chat.handleReset}
            sttOnline={sttOnline}
            ttsOnline={ttsOnline}
            isVlm={isMultimodal}
            imagePreviews={chat.imagePreviews}
            onImageSelect={chat.handleImageSelect}
            onImageRemove={chat.handleRemoveImage}
          />
        </div>
      </FeatureContexts>
    </div>
  )
}

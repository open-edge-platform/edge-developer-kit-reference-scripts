// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Database } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useMediaQuery } from '@/hooks/use-media-query'
import { FeatureContexts } from '@/samples/common/feature-providers/feature-contexts'
import { useSampleChatFeatures } from '@/samples/common/feature-providers/use-sample-chat-features'
import { useTextGenerationParams } from '@/samples/common/hooks'
import { useTextGenModelSupport } from '@/samples/common/hooks/use-text-gen-model'
import { useSampleWorkspace } from '@/samples/common/sample-workspace'
import { SampleParamsSlot } from '@/samples/common/sample-params-slot'
import { ConversationPanel } from '@/services/text-generation/components/conversation-panel'
import { useTextGenChat } from '@/services/text-generation/hooks/use-chat'
import { KnowledgeBasePanel } from '@/services/vectordb/components/knowledge-base-panel'
import { useRagParams } from '@/services/vectordb/hooks/use-rag-params'
import type { ServiceParamGroup } from '@/types/demo-params'
import type { Sample } from '../types'

/** Fill the composer; the user still sends explicitly. */
const EXAMPLE_QUESTIONS = [
  'Summarize the documents in this knowledge base.',
  'What are the main topics covered in the uploaded files?',
  'List the dates, names and figures mentioned in the documents.',
]

export function RagChatbotDemo({ sample }: { sample: Sample }) {
  const textGen = useTextGenerationParams({
    systemPromptTooltip:
      'Optional. Add {context} where you want the retrieved knowledge-base context inserted. If you omit {context}, the context is appended to the end of your prompt.',
  })
  const rag = useRagParams()
  const workspace = useSampleWorkspace()
  // The knowledge base is a column beside the chat when there is room, and
  // a sheet otherwise, so the conversation stays usable on a phone.
  const isWide = useMediaQuery('(min-width: 1024px)')
  const [knowledgeBaseOpen, setKnowledgeBaseOpen] = useState(false)

  // Optional integrations come from data.ts. RAG is required here, so it stays a direct hook
  // and its knowledge base renders as a column, not in the Parameters sheet.
  const features = useSampleChatFeatures(sample)
  const { isMultimodal } = useTextGenModelSupport()

  const hasKnowledgeBase = rag.selectedKb != null && rag.vectordbOnline
  const suspended = workspace.suspended

  const chat = useTextGenChat({
    textGenValues: textGen.values,
    requestParams: textGen.requestParams,
    extraBody: { ...rag.extraBody, ...features.extraBody },
  })

  const groups = [
    textGen.group,
    features.group('text-to-speech'),
    features.group('speech-to-text'),
    ...rag.groups,
    features.group('mcp'),
  ].filter((g): g is ServiceParamGroup => g != null)

  const placeholder = suspended
    ? `Waiting for ${workspace.offlineRequired.join(', ')}…`
    : hasKnowledgeBase
      ? 'Ask a question about your documents…'
      : 'Choose a knowledge base first, or ask without one…'
  const emptyStateText = suspended
    ? 'Your conversation is kept. Sending resumes once the required services are back.'
    : hasKnowledgeBase
      ? `Ask a question about “${rag.selectedKb?.name}”.`
      : 'Choose a knowledge base and add documents, then ask a question about them.'

  const knowledgeBase = (
    <KnowledgeBasePanel
      apiBase={rag.vectordbApiBase}
      selectedKb={rag.selectedKb}
      onSelectKb={rag.onSelectKb}
      siblings={rag.siblings}
    />
  )

  return (
    <div className="space-y-4">
      {features.renderProviders(chat.setInput)}

      <SampleParamsSlot groups={groups} />

      <FeatureContexts exports={features.exports}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          {isWide && <aside aria-label="Knowledge base">{knowledgeBase}</aside>}
          <ConversationPanel
            messages={chat.messages}
            status={chat.status}
            input={chat.input}
            onInputChange={chat.setInput}
            onSend={chat.handleSend}
            onStop={chat.handleStop}
            onReset={chat.handleReset}
            error={chat.error}
            onRetry={chat.handleRetry}
            disabled={suspended}
            sttOnline={features.sttOnline}
            ttsOnline={features.ttsOnline}
            attachments={chat.attachments}
            allowImageAttach={isMultimodal}
            placeholder={placeholder}
            emptyStateText={emptyStateText}
            examplePrompts={
              hasKnowledgeBase && !suspended ? EXAMPLE_QUESTIONS : undefined
            }
            headerActions={
              isWide ? undefined : (
                <Sheet
                  open={knowledgeBaseOpen}
                  onOpenChange={setKnowledgeBaseOpen}
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 max-w-[220px] gap-1.5 text-xs"
                    onClick={() => setKnowledgeBaseOpen(true)}
                    aria-haspopup="dialog"
                  >
                    <Database className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate">
                      {rag.selectedKb ? rag.selectedKb.name : 'Knowledge base'}
                    </span>
                  </Button>
                  <SheetContent
                    side="right"
                    className="w-full overflow-y-auto sm:max-w-[360px]"
                  >
                    <SheetHeader>
                      <SheetTitle>Knowledge base</SheetTitle>
                      <SheetDescription>
                        Choose a collection and add documents. The conversation
                        stays where it is.
                      </SheetDescription>
                    </SheetHeader>
                    <div className="px-4 pb-6">{knowledgeBase}</div>
                  </SheetContent>
                </Sheet>
              )
            }
            messagesClassName="max-h-[520px] min-h-[360px]"
          />
        </div>
      </FeatureContexts>
    </div>
  )
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { FeatureContexts } from '@/samples/common/feature-providers/feature-contexts'
import { ConversationPanel } from '@/services/text-generation/components/conversation-panel'
import type { ExamChat } from '../hooks/use-exam-chat'

/** The Chatbot tab: questions about the graded results. */
export function ExamChatbot({ chat, features }: ExamChat) {
  return (
    <FeatureContexts exports={features.exports}>
      <ConversationPanel
        messages={chat.messages}
        status={chat.status}
        input={chat.input}
        onInputChange={chat.setInput}
        onSend={() => chat.handleSend()}
        onStop={chat.handleStop}
        onReset={chat.handleReset}
        error={chat.error}
        onRetry={chat.handleRetry}
        sttOnline={features.sttOnline}
        ttsOnline={features.ttsOnline}
        emptyStateText="Ask me anything about exam results or marking"
        placeholder="e.g. Which students scored above 80%?"
        messagesClassName="max-h-[480px] min-h-[320px]"
      />
    </FeatureContexts>
  )
}

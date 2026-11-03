// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useSampleChatFeatures } from '@/samples/common/feature-providers/use-sample-chat-features'
import { useTextGenerationParams } from '@/samples/common/hooks'
import type { Sample } from '@/samples/types'
import { useTextGenChat } from '@/services/text-generation/hooks/use-chat'
import type { DashboardStats } from '../lib/dashboard-stats'
import { buildResultsContext } from '../lib/prompts'

/** The Chatbot tab's conversation over the class results, held by the demo to outlive a tab switch. */
export function useExamChat(sample: Sample, stats: DashboardStats | null) {
  const textGen = useTextGenerationParams({
    systemPromptTooltip:
      'Optional. Instructions for the assistant; the class results it answers from are added after them.',
  })
  const features = useSampleChatFeatures(sample)

  const userPrompt = textGen.values.systemPrompt.trim()
  const resultsContext = buildResultsContext(stats)
  const chat = useTextGenChat({
    textGenValues: {
      ...textGen.values,
      systemPrompt: userPrompt
        ? `${userPrompt}\n\n${resultsContext}`
        : resultsContext,
    },
    requestParams: textGen.requestParams,
    extraBody: features.extraBody,
  })

  return {
    chat,
    features,
    /** The Parameters sheet's groups: Text Generation, then the integrations. */
    groups: [textGen.group, ...features.groups],
  }
}

export type ExamChat = ReturnType<typeof useExamChat>

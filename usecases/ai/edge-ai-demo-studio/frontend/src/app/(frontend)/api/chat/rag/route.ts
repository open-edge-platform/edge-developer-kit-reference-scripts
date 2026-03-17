// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { EMBEDDING_PORT, TEXT_GENERATION_PORT } from '@/lib/constants'
import { TEXT_GENERATION_TYPE } from '@/lib/workloads/text-generation'
import { logger } from '@/utils/logger'
import { getWorkloadModel } from '@/utils/workload/service'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  UIMessage,
  convertToModelMessages,
  extractReasoningMiddleware,
  streamText,
  wrapLanguageModel,
} from 'ai'

// Configuration constants
const createDefaultSystemPrompt = () => {
  return `/no_think You are a human-like conversational AI. 
Your goal is to communicate in a way that is natural, empathetic, and engaging. 
Prioritize clarity and warmth in your responses.
You only reply in plain natural language, Do not produce any HIGHLIGHT, Markdown format, programming codes, formatted structured output`
}

const createRAGContextPrompt = async (
  knowledgeBaseId: number,
  query: string,
) => {
  const searchParams = {
    query,
    search_type: 'similarity',
    top_k: 4,
    top_n: 3,
  }

  try {
    const sanitizedURL = new URL(
      `http://localhost:${EMBEDDING_PORT}/v1/kb/${knowledgeBaseId}/search`,
    )
    const response = await fetch(sanitizedURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(searchParams),
    })

    if (!response.ok) {
      throw new Error(`Search failed with status: ${response.status}`)
    }

    const searchResults = await response.json()

    // Create system message with RAG context
    const contextContent = searchResults
      .map((result: { content: string }) => result.content)
      .join('\n\n---\n\n')

    const systemMessage = `/no_think
Use the following pieces of retrieved context to answer the question. 
If you don't know the answer, just say that you do not know the answer.

Context: ${contextContent}
Answer:`
    return systemMessage
  } catch (error) {
    logger.error('RAG search error:', error)
    // Return default system prompt if search fails
    return createDefaultSystemPrompt()
  }
}

export async function POST(req: Request) {
  const {
    messages,
    knowledgeBaseId,
  }: {
    messages: UIMessage[]
    knowledgeBaseId: number
  } = await req.json()

  // Get available model
  let model: string
  try {
    model = await getWorkloadModel(TEXT_GENERATION_TYPE)
  } catch (error) {
    logger.error('Model service error:', error)
    return new Response('No available model', { status: 500 })
  }

  // Create OpenAI compatible provider
  const provider = createOpenAICompatible({
    baseURL: `http://localhost:${TEXT_GENERATION_PORT}/v1`,
    name: 'ovms',
  })

  const ragContext = knowledgeBaseId
    ? await createRAGContextPrompt(
        knowledgeBaseId,
        messages[messages.length - 1].parts
          .map((part) => {
            if (part.type === 'text') return part.text
            else return ''
          })
          .join(''),
      )
    : undefined

  const wrappedModel = wrapLanguageModel({
    model: provider(model),
    middleware: extractReasoningMiddleware({ tagName: 'think' }),
  })

  const result = streamText({
    model: wrappedModel,
    system: ragContext ?? createDefaultSystemPrompt(),
    messages: convertToModelMessages(messages),
  })

  return result.toUIMessageStreamResponse()
}

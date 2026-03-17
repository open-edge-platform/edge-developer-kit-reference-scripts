// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { EMBEDDING_PORT, TEXT_GENERATION_PORT } from '@/lib/constants'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  UIMessage,
  convertToModelMessages,
  extractReasoningMiddleware,
  streamText,
  wrapLanguageModel,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  UIMessageStreamWriter,
  UIDataTypes,
  UITools,
  generateId,
} from 'ai'
import { hermesToolMiddleware } from '@ai-sdk-tool/parser'
import { logger } from '@/utils/logger'
import { getWorkloadModel } from '@/utils/workload/service'
import { SentenceProcessor } from '@/utils/sentence-processor'
import { getMcpTools } from '@/utils/mcp'
import { TEXT_GENERATION_TYPE } from '@/lib/workloads/text-generation'

const TOOL_USAGE_GUIDELINES = `\nIMPORTANT - Tool Usage Guidelines:
- If the context doesn't have the answer, use available tools silently to get more information
- NEVER mention tool names, function calls, or technical details
- NEVER show JSON, code, or function syntax in your responses
- After getting tool results, provide a natural conversational answer
- Speak as if you naturally know the information
- Focus on answering the question directly and naturally`

// Configuration constants
const createDefaultSystemPrompt = (
  language: string,
  hasTools: boolean = false,
) => {
  const toolInstruction = hasTools ? TOOL_USAGE_GUIDELINES : ''

  return `/no_think You are a human-like conversational AI. 
Your goal is to communicate in a way that is natural, empathetic, and engaging. 
Prioritize clarity and warmth in your responses.
You always respond in ${language} ISO 639-1 language code standard.${toolInstruction}
You only reply in plain natural language, Do not produce any HIGHLIGHT, Markdown format, programming codes, formatted structured output`
}

// Sentence handler for processing completed sentences
class TTSSentenceHandler {
  static handleCompletedSentence(
    writer: UIMessageStreamWriter<UIMessage<unknown, UIDataTypes, UITools>>,
    statusId: string,
    sentence: string,
  ): void {
    // Remove special characters and emojis
    const processedSentence = sentence
      .replace(
        /[*#]|[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
        '',
      )
      .trim()

    writer.write({
      type: 'data-new-sentence',
      id: statusId,
      data: {
        sentence: processedSentence,
      },
    })
  }
}

const createRAGContextPrompt = async (
  knowledgeBaseId: number,
  query: string,
  language: string,
  hasTools: boolean = false,
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

    const toolInstruction = hasTools ? TOOL_USAGE_GUIDELINES : ''

    const systemMessage = `/no_think
Use the following pieces of retrieved context to answer the question. 
If you don't know the answer from the context, use available tools if needed, but never mention using them.
Always respond in ${language} ISO language standard${toolInstruction}

Context: ${contextContent}
Answer:`
    return systemMessage
  } catch (error) {
    logger.error('RAG search error:', error)
    // Return default system prompt if search fails
    return createDefaultSystemPrompt(language, hasTools)
  }
}

export async function POST(req: Request) {
  const {
    messages,
    language,
    knowledgeBaseId,
    useMcpTools = false,
    tools = [],
    maxSteps = 3,
  }: {
    messages: UIMessage[]
    language: string
    knowledgeBaseId: number
    useMcpTools: boolean
    tools?: string[]
    maxSteps?: number
  } = await req.json()

  // Get available model
  let model: string
  try {
    model = await getWorkloadModel(TEXT_GENERATION_TYPE)
  } catch (error) {
    logger.error('Model service error:', error)
    return new Response('No available model', { status: 500 })
  }

  // Initialize sentence processor
  const sentenceProcessor = new SentenceProcessor()

  // Create OpenAI compatible provider
  const provider = createOpenAICompatible({
    baseURL: `http://localhost:${TEXT_GENERATION_PORT}/v1`,
    name: 'ovms',
  })

  // Get MCP tools first to determine if tools are available
  const mcpTools = useMcpTools ? await getMcpTools(tools) : {}
  const hasTools = Object.keys(mcpTools).length > 0
  const toolChoice = hasTools ? ('auto' as const) : ('none' as const)

  // Create RAG context with tool awareness
  const ragContext = knowledgeBaseId
    ? await createRAGContextPrompt(
        knowledgeBaseId,
        messages[messages.length - 1].parts
          .map((part) => {
            if (part.type === 'text') return part.text
            else return ''
          })
          .join(''),
        language,
        hasTools,
      )
    : undefined

  const wrappedModel = wrapLanguageModel({
    model: provider(model),
    middleware: [
      hermesToolMiddleware,
      extractReasoningMiddleware({ tagName: 'think' }),
    ],
  })

  const statusId = generateId()

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      const result = streamText({
        model: wrappedModel,
        system: ragContext ?? createDefaultSystemPrompt(language, hasTools),
        messages: convertToModelMessages(messages),
        stopWhen: stepCountIs(maxSteps),
        toolChoice,
        tools: mcpTools,
        onChunk({ chunk }) {
          if (chunk.type === 'text-delta') {
            const completedSentences = sentenceProcessor.addTextChunk(
              chunk.text,
            )
            // Handle each completed sentence
            completedSentences.forEach((sentence) => {
              TTSSentenceHandler.handleCompletedSentence(
                writer,
                statusId,
                sentence,
              )
            })
          }
        },
        onFinish() {
          const finalSentences = sentenceProcessor.finishProcessing()

          // Handle final sentences
          finalSentences.forEach((sentence) => {
            TTSSentenceHandler.handleCompletedSentence(
              writer,
              statusId,
              sentence,
            )
          })
        },
      })

      writer.merge(result.toUIMessageStream())
    },
  })

  return createUIMessageStreamResponse({ stream })
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import config from '@payload-config'
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  extractReasoningMiddleware,
  stepCountIs,
  streamText,
  type UIMessage,
  wrapLanguageModel,
} from 'ai'
import { getPayload } from 'payload'
import { engines } from '@/engines/registry'
import { logger } from '@/lib/logger'
import { buildMcpTools } from '@/lib/mcp-tools'
import type { Service } from '@/payload-types'
import { metaMap } from '@/services/_generated/meta'

const createDefaultSystemPrompt = () => {
  return `You are a human-like conversational AI. 
Your goal is to communicate in a way that is natural, empathetic, and engaging. 
Prioritize clarity and warmth in your responses.
You only reply in plain natural language, Do not produce any HIGHLIGHT, Markdown format, programming codes, formatted structured output`
}

function createRAGSystemPrompt(context: string) {
  return `You are a helpful assistant that answers questions based on provided context.
Use the following pieces of retrieved context to answer the question.
If you don't know the answer from the context, say so honestly instead of making things up.
Always ground your responses in the provided context.

Context:
${context}

Answer the user's question based on the context above.`
}

async function fetchRAGContext(
  knowledgeBaseId: number,
  query: string,
  topK: number = 4,
): Promise<string | null> {
  const vectordbMeta = metaMap['vectordb']
  if (!vectordbMeta) return null

  try {
    const url = new URL(
      `http://localhost:${vectordbMeta.port}/v1/kb/${knowledgeBaseId}/search`,
    )
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        search_type: 'similarity',
        top_k: topK,
        top_n: 3,
      }),
    })

    if (!response.ok) {
      logger.error(`RAG search failed: ${response.status}`)
      return null
    }

    const results = await response.json()
    if (!Array.isArray(results) || results.length === 0) return null

    return results
      .map((r: { content: string }) => r.content)
      .join('\n\n---\n\n')
  } catch (error) {
    logger.error('RAG context fetch error:', error)
    return null
  }
}

function getLastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return messages[i].parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('')
    }
  }
  return ''
}

function cleanupImageMessage(messages: UIMessage[]): UIMessage[] {
  return messages.map((msg) => {
    if (msg.role === 'user') {
      msg.parts.forEach((p) => {
        if (p.type === 'file') {
          const url = p.url
          const [, base64] = url.split(',', 2)
          p.url = base64
        }
      })
    }

    return msg
  })
}

async function getWorkloadModel(
  workloadType: Service['type'],
): Promise<string> {
  const payload = await getPayload({ config })
  const textGenerationDoc = await payload.find({
    collection: 'services',
    where: { type: { equals: workloadType } },
    limit: 1,
  })

  if (textGenerationDoc.totalDocs < 1)
    return Promise.reject(`No ${workloadType} workload found`)

  const textGenerationWorkload = textGenerationDoc.docs[0]
  const selectedEngine = engines[textGenerationWorkload.engine]
  return selectedEngine.getModelName(
    textGenerationWorkload.models.default,
    true,
  )
}

export async function POST(req: Request) {
  const {
    messages,
    systemPrompt: customSystemPrompt,
    maxTokens,
    temperature,
    topP,
    topK,
    repetitionPenalty,
    knowledgeBaseId,
    disableReasoning,
    mcpServerIds,
  }: {
    messages: UIMessage[]
    systemPrompt?: string
    maxTokens?: number
    temperature?: number
    topP?: number
    topK?: number
    repetitionPenalty?: number
    knowledgeBaseId?: number
    disableReasoning?: boolean
    mcpServerIds?: number[]
  } = await req.json()

  // Get available model
  let model: string
  const textGenerationMeta = metaMap['text-generation']
  try {
    model = await getWorkloadModel(textGenerationMeta.id)
  } catch (error) {
    logger.error('Model service error:', error)
    return new Response('No available model', { status: 500 })
  }

  // Build system prompt — use custom prompt if provided, otherwise default
  let systemPrompt = customSystemPrompt?.trim() || createDefaultSystemPrompt()
  if (knowledgeBaseId != null) {
    const query = getLastUserText(messages)
    if (query) {
      const context = await fetchRAGContext(knowledgeBaseId, query, topK)
      if (context) {
        systemPrompt = createRAGSystemPrompt(context)
      }
    }
  }

  // When reasoning is disabled, ensure /no_think prefix is present
  if (disableReasoning && !systemPrompt.startsWith('/no_think')) {
    systemPrompt = `/no_think ${systemPrompt}`
  }

  // Create OpenAI compatible provider using absolute Next.js proxy URL
  const provider = createOpenAICompatible({
    baseURL: `http://localhost:${textGenerationMeta.port}/v1`,
    name: 'ovms',
    fetch: async (url, options) => {
      if (options?.body) {
        const body = JSON.parse(options.body.toString())
        body.repetition_penalty = repetitionPenalty
        options.body = JSON.stringify(body)
      }
      const newURL = new URL(url.toString())
      return fetch(newURL, options)
    },
  })

  const baseModel = provider(model)
  const wrappedModel = disableReasoning
    ? baseModel
    : wrapLanguageModel({
        model: baseModel,
        middleware: extractReasoningMiddleware({ tagName: 'think' }),
      })

  // Build MCP tools if server IDs were provided
  let mcpTools: Awaited<ReturnType<typeof buildMcpTools>> | undefined
  if (mcpServerIds && mcpServerIds.length > 0) {
    mcpTools = await buildMcpTools(mcpServerIds)
  }
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const modelMessages = await convertToModelMessages(
        cleanupImageMessage(messages),
      )

      const result = streamText({
        model: wrappedModel,
        system: systemPrompt,
        messages: modelMessages,
        maxOutputTokens: maxTokens,
        temperature,
        topP,
        topK,
        ...(mcpTools && Object.keys(mcpTools.tools).length > 0
          ? { tools: mcpTools.tools, stopWhen: stepCountIs(5) }
          : {}),
        onFinish: async () => {
          await mcpTools?.cleanup()
        },
      })
      writer.merge(result.toUIMessageStream())
    },
  })

  return createUIMessageStreamResponse({ stream })
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
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
import { logger } from '@/lib/logger'
import { buildMcpTools } from '@/lib/mcp-tools'
import { SentenceProcessor } from '@/lib/sentence-processor'
import { metaMap } from '@/services/_generated/meta'
import { hermesToolMiddleware } from '@ai-sdk-tool/parser'
import { getWorkloadModel } from '@/app/api/common/get-workload-model'
import {
  type ConcreteReasoningParserId,
  resolveReasoningParser,
} from '@/lib/reasoning-parsers'

function createReasoningMiddleware(parser: ConcreteReasoningParserId) {
  switch (parser) {
    case 'none':
      return null
    case 'qwen3.5':
      return extractReasoningMiddleware({
        tagName: 'think',
        startWithReasoning: true,
      })
    case 'default':
      return extractReasoningMiddleware({ tagName: 'think' })
  }
}

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

const RAG_CONTEXT_PLACEHOLDER = /\{\s*context\s*\}/gi

function injectRAGContext(customPrompt: string, context: string): string {
  const replaced = customPrompt.replace(RAG_CONTEXT_PLACEHOLDER, context)
  if (replaced !== customPrompt) return replaced
  return `${customPrompt}\n\nContext:\n${context}`
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
    if (msg.role !== 'user') return msg
    return {
      ...msg,
      parts: msg.parts.map((p) => {
        if (p.type === 'file') {
          const [, base64] = p.url.split(',', 2)
          return { ...p, url: base64 }
        }
        return p
      }),
    }
  })
}

interface LipsyncConfig {
  sessionId: string
  voice: string
  speed: string
  frameGeneration?: boolean
}

function dispatchSentenceToLipsync(
  sentence: string,
  lipsync: LipsyncConfig,
): void {
  const lipsyncMeta = metaMap['lipsync']
  if (!lipsyncMeta) return

  // Derive the TTS URL server-side from trusted config to prevent SSRF.
  const ttsMeta = metaMap['text-to-speech']
  const ttsUrl = ttsMeta ? `http://localhost:${ttsMeta.port}/v1` : undefined

  fetch(`http://localhost:${lipsyncMeta.port}/v1/lipsync/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: sentence,
      session_id: lipsync.sessionId,
      chat_type: 'echo',
      voice: lipsync.voice,
      speed: lipsync.speed,
      frame_generation: lipsync.frameGeneration ?? false,
      ...(ttsUrl ? { tts_url: ttsUrl } : {}),
    }),
  }).catch((err) => {
    logger.error('Failed to dispatch sentence to lipsync:', err)
  })
}

export async function POST(req: Request) {
  let body: {
    messages: UIMessage[]
    systemPrompt?: string
    maxTokens?: number
    temperature?: number
    topP?: number
    topK?: number
    repetitionPenalty?: number
    knowledgeBaseId?: number
    disableReasoning?: boolean
    reasoningParser?: string
    mcpServerIds?: number[]
    lipsync?: LipsyncConfig
  }

  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON in request body', { status: 400 })
  }

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
    reasoningParser,
    mcpServerIds,
    lipsync,
  } = body

  // Get available model
  let model: string
  const textGenerationMeta = metaMap['text-generation']
  try {
    model = await getWorkloadModel(textGenerationMeta.id)
  } catch (error) {
    logger.error('Model service error:', error)
    return new Response('No available model', { status: 500 })
  }

  const trimmedCustomPrompt = customSystemPrompt?.trim()
  let systemPrompt = trimmedCustomPrompt || createDefaultSystemPrompt()
  if (knowledgeBaseId != null) {
    const query = getLastUserText(messages)
    if (query) {
      const context = await fetchRAGContext(knowledgeBaseId, query, topK)
      if (context) {
        systemPrompt = trimmedCustomPrompt
          ? injectRAGContext(trimmedCustomPrompt, context)
          : createRAGSystemPrompt(context)
      }
    }
  }

  const provider = createOpenAICompatible({
    baseURL: `http://localhost:${textGenerationMeta.port}/v1`,
    name: 'ovms',
    fetch: async (url, options) => {
      if (options?.body && (repetitionPenalty != null || disableReasoning)) {
        const body = JSON.parse(options.body.toString())
        if (repetitionPenalty != null) {
          body.repetition_penalty = repetitionPenalty
        }

        if (disableReasoning) {
          body.chat_template_kwargs = {
            ...body.chat_template_kwargs,
            enable_thinking: false,
          }
        }
        options = { ...options, body: JSON.stringify(body) }
      }
      const newURL = new URL(url.toString())
      return fetch(newURL, options)
    },
  })

  let mcpTools: Awaited<ReturnType<typeof buildMcpTools>> | undefined
  logger.info('MCP Server IDs:', mcpServerIds)
  if (mcpServerIds && mcpServerIds.length > 0) {
    mcpTools = await buildMcpTools(mcpServerIds)
  }

  const hasTools = mcpTools != null && Object.keys(mcpTools.tools).length > 0

  const baseModel = provider(model)
  // Resolve the reasoning parser (user choice, or model-aware default) and
  // build the middleware stack. Reasoning parsing is skipped entirely when the
  // user has disabled reasoning.
  const reasoningMiddleware = disableReasoning
    ? null
    : createReasoningMiddleware(resolveReasoningParser(reasoningParser, model))
  const wrappedModel = wrapLanguageModel({
    model: baseModel,
    middleware: [
      ...(hasTools ? [hermesToolMiddleware] : []),
      ...(reasoningMiddleware ? [reasoningMiddleware] : []),
    ],
  })
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const modelMessages = await convertToModelMessages(
        cleanupImageMessage(messages),
      )

      // Initialize sentence processor for lipsync sentence-by-sentence streaming
      const sentenceProcessor = lipsync ? new SentenceProcessor() : null

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
        onChunk({ chunk }) {
          if (chunk.type === 'text-delta' && sentenceProcessor && lipsync) {
            const sentences = sentenceProcessor.addTextChunk(chunk.text)
            for (const sentence of sentences) {
              dispatchSentenceToLipsync(sentence, lipsync)
            }
          }
        },
        onFinish: async () => {
          if (sentenceProcessor && lipsync) {
            const finalSentences = sentenceProcessor.flush()
            for (const sentence of finalSentences) {
              dispatchSentenceToLipsync(sentence, lipsync)
            }
          }
          await mcpTools?.cleanup()
        },
      })
      writer.merge(result.toUIMessageStream())
    },
  })

  return createUIMessageStreamResponse({ stream })
}

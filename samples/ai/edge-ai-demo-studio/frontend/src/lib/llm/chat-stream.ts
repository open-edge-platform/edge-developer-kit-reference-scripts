// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Streaming chat answer: an OpenAI-compatible call to a Text Generation instance, with tool-call and
 * `<think>` parsers, MCP tools, and the AI SDK UI message stream around it.
 */

import {
  hermesToolMiddleware,
  qwen3CoderToolMiddleware,
} from '@ai-sdk-tool/parser'
import {
  APICallError,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  extractReasoningMiddleware,
  isStepCount,
  type LanguageModelMiddleware,
  RetryError,
  streamText,
  type TextStreamPart,
  type ToolSet,
  type UIMessage,
  wrapLanguageModel,
} from 'ai'
import { getErrorMessage } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { createOvmsProvider } from '@/lib/llm/ovms-provider'
import {
  DEFAULT_TOOL_CALL_PARSER,
  type ToolCallParserId,
} from '@/lib/llm/tool-call-parsers'

export interface ChatTools {
  tools: ToolSet
  /** Closes the MCP clients behind `tools`; called once, however the answer ends. */
  cleanup: () => Promise<void>
}

/** Tool-calling rounds an answer may take before it has to reply. */
const MAX_TOOL_STEPS = 5

const TOOL_CALL_MIDDLEWARE: Record<
  Exclude<ToolCallParserId, 'native'>,
  LanguageModelMiddleware
> = {
  hermes: hermesToolMiddleware,
  qwen3coder: qwen3CoderToolMiddleware,
}

export interface ChatStreamOptions {
  /** Loopback base URL of the Text Generation instance. */
  baseUrl: string
  /** The model name the engine expects (`openvino:<repo>`). */
  model: string
  messages: UIMessage[]
  instructions: string
  /** The request's signal: a client that stops the chat stops the model. */
  abortSignal: AbortSignal
  tools?: ChatTools
  /** Split `<think>…</think>` reasoning out of the answer. */
  parseReasoning: boolean
  /** `hermes` when unset; with `native` the engine parses the calls from API tool declarations. */
  toolCallParser?: ToolCallParserId
  /** Edits the request body before it is sent (OVMS-only fields). */
  patchBody?: (body: Record<string, unknown>) => void
  maxOutputTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  messageMetadata?: (options: {
    part: TextStreamPart<ToolSet>
  }) => unknown | undefined
  onTextDelta?: (text: string) => void
  onFinish?: () => void
  /** The client stopped the answer part-way. */
  onAbort?: () => void
}

/**
 * The engine's own failure reason, not the SDK's "An error occurred." (the engine is the user's own,
 * on loopback). A FastAPI `{"detail"}` body is not the OpenAI error shape, so it is read here.
 */
function chatErrorMessage(error: unknown): string {
  const last = RetryError.isInstance(error) ? error.lastError : error
  if (APICallError.isInstance(last) && last.responseBody) {
    try {
      const body: unknown = JSON.parse(last.responseBody)
      const detail =
        body && typeof body === 'object' && 'detail' in body
          ? body.detail
          : undefined
      if (typeof detail === 'string' && detail.trim()) return detail.trim()
    } catch {
      // Not JSON: the SDK's message stands.
    }
  }
  return getErrorMessage(last, 'The model request failed.')
}

function once(cleanup: () => Promise<void>): () => Promise<void> {
  let done: Promise<void> | undefined
  return () => {
    if (!done) {
      done = cleanup().catch((error) => {
        logger.error('Failed to close the chat tools:', error)
      })
    }
    return done
  }
}

export function streamChatResponse(options: ChatStreamOptions): Response {
  const { tools, onTextDelta, onFinish, onAbort } = options
  const cleanup = once(tools?.cleanup ?? (() => Promise.resolve()))
  const hasTools = tools !== undefined && Object.keys(tools.tools).length > 0
  const toolCallParser = options.toolCallParser ?? DEFAULT_TOOL_CALL_PARSER

  const middleware: LanguageModelMiddleware[] = [
    ...(hasTools && toolCallParser !== 'native'
      ? [TOOL_CALL_MIDDLEWARE[toolCallParser]]
      : []),
    ...(options.parseReasoning
      ? [extractReasoningMiddleware({ tagName: 'think' })]
      : []),
  ]
  const provider = createOvmsProvider({
    baseUrl: options.baseUrl,
    patchBody: options.patchBody,
  })
  const model = wrapLanguageModel({
    model: provider(options.model),
    middleware,
  })

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const result = streamText({
        model,
        instructions: options.instructions,
        messages: await convertToModelMessages(options.messages),
        maxOutputTokens: options.maxOutputTokens,
        temperature: options.temperature,
        topP: options.topP,
        topK: options.topK,
        // Without it the engine keeps generating for nobody after the client stops.
        abortSignal: options.abortSignal,
        ...(hasTools
          ? { tools: tools.tools, stopWhen: isStepCount(MAX_TOOL_STEPS) }
          : {}),
        onChunk({ chunk }) {
          if (chunk.type === 'text-delta') onTextDelta?.(chunk.text)
        },
        onError({ error }) {
          logger.error('Chat stream error:', error)
        },
        onEnd: () => onFinish?.(),
        // An aborted stream skips `onEnd`.
        onAbort: () => onAbort?.(),
      })
      writer.merge(
        result.toUIMessageStream({
          messageMetadata: options.messageMetadata,
          onError: chatErrorMessage,
        }),
      )
    },
    onError: chatErrorMessage,
    // The UI stream ends however the answer does (the model's `onEnd` is skipped on failure).
    onEnd: cleanup,
  })

  return createUIMessageStreamResponse({ stream })
}

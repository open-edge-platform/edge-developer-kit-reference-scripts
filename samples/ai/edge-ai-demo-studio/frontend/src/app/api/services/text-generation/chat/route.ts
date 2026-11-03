// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { UIMessage } from 'ai'
import { z } from 'zod'
import { jsonErrorFrom, parseJsonBody } from '@/lib/api/json'
import { chatUsageMetadata } from '@/lib/llm/chat-usage'
import {
  buildChatSystemPrompt,
  vectordbConfigSchema,
} from '@/lib/llm/chat-prompts'
import { streamChatResponse } from '@/lib/llm/chat-stream'
import {
  createLipsyncForwarder,
  resolveLipsyncUrls,
} from '@/lib/llm/lipsync-forwarder'
import { buildMcpTools } from '@/lib/llm/mcp-tools'
import { resolveReasoningParser } from '@/lib/llm/reasoning-parsers'
import { resolveToolCallParser } from '@/lib/llm/tool-call-parsers'
import { SentenceProcessor } from '@/lib/llm/sentence-processor'
import {
  boundInstanceKey,
  resolveWorkload,
} from '@/lib/workers/instance-lookup'

/** An optional field a client may also send as `null`. */
const optional = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? undefined)

const chatBodySchema = z.object({
  messages: z.array(z.custom<UIMessage>((m) => !!m && typeof m === 'object')),
  systemPrompt: optional(z.string()),
  maxTokens: optional(z.number()),
  temperature: optional(z.number()),
  topP: optional(z.number()),
  topK: optional(z.number()),
  repetitionPenalty: optional(z.number()),
  // Part of the vector database URL path: a row id, nothing else.
  knowledgeBaseId: optional(z.number().int().nonnegative()),
  vectordbConfig: optional(vectordbConfigSchema),
  disableReasoning: optional(z.boolean()),
  reasoningParser: optional(z.string()),
  mcpServerIds: optional(z.array(z.number().int())),
  /** How tool calls are read: `hermes` (default), `qwen3coder` or `native`. */
  toolCallParser: optional(z.string()),
  /** Hand MCP results made only of text to the model as that text (off by default). */
  mcpTextResults: optional(z.boolean()),
  lipsync: optional(
    z.object({
      sessionId: z.string().min(1),
      voice: z.string(),
      speed: z.coerce.string(),
      frameGeneration: optional(z.boolean()),
    }),
  ),
  /** Text Generation instance to use (`text-generation@<id>`); the running one when omitted. */
  instanceKey: optional(z.string()),
  /**
   * Instances a sample binds, by type (Text Generation wins over `instanceKey`); each falls back to
   * its running instance.
   */
  instances: optional(z.record(z.string(), z.unknown())),
})

export async function POST(req: Request) {
  const parsed = await parseJsonBody(req, chatBodySchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const { instances, lipsync, repetitionPenalty, disableReasoning } = body

  let target: { model: string; baseUrl: string }
  try {
    target = await resolveWorkload(
      'text-generation',
      boundInstanceKey(instances, 'text-generation') ?? body.instanceKey,
    )
  } catch (error) {
    return jsonErrorFrom(error, 'No available model', 'Model service error')
  }

  const instructions = await buildChatSystemPrompt({
    customPrompt: body.systemPrompt,
    messages: body.messages,
    knowledgeBaseId: body.knowledgeBaseId,
    topK: body.topK,
    vectordbInstanceKey: boundInstanceKey(instances, 'vectordb'),
    vectordbConfig: body.vectordbConfig,
  })

  // Resolved once per request — not per sentence — so dispatch stays
  // synchronous and ordered as the answer streams.
  const lipsyncUrls = lipsync
    ? await resolveLipsyncUrls(
        boundInstanceKey(instances, 'lipsync'),
        boundInstanceKey(instances, 'text-to-speech'),
      )
    : null
  const forwarder =
    lipsync && lipsyncUrls ? createLipsyncForwarder(lipsync, lipsyncUrls) : null
  const sentences = forwarder ? new SentenceProcessor() : null

  // Last before the stream, which owns (and closes) the MCP clients.
  const tools = body.mcpServerIds?.length
    ? await buildMcpTools(body.mcpServerIds, {
        textResults: body.mcpTextResults ?? false,
      })
    : undefined

  return streamChatResponse({
    ...target,
    messages: body.messages,
    instructions,
    abortSignal: req.signal,
    tools,
    toolCallParser: resolveToolCallParser(body.toolCallParser),
    parseReasoning:
      !disableReasoning &&
      resolveReasoningParser(body.reasoningParser) !== 'none',
    patchBody:
      repetitionPenalty != null || disableReasoning
        ? (request) => {
            if (repetitionPenalty != null) {
              request.repetition_penalty = repetitionPenalty
            }
            if (disableReasoning) {
              request.chat_template_kwargs = {
                ...(request.chat_template_kwargs as
                  Record<string, unknown> | undefined),
                enable_thinking: false,
              }
              // With thinking off a `</think>` is an artifact: Qwen3.5 int4 emits one after its
              // answer and can repeat it up to the token limit.
              const stop = request.stop
              request.stop = [
                ...(Array.isArray(stop) ? stop : stop ? [stop] : []),
                '</think>',
              ]
            }
          }
        : undefined,
    maxOutputTokens: body.maxTokens,
    temperature: body.temperature,
    topP: body.topP,
    topK: body.topK,
    // With its token counts, for the demo's Live metrics.
    messageMetadata: chatUsageMetadata,
    onTextDelta: (text) => {
      for (const sentence of sentences?.addTextChunk(text) ?? []) {
        forwarder?.send(sentence)
      }
    },
    onFinish: () => {
      for (const sentence of sentences?.flush() ?? []) {
        forwarder?.send(sentence)
      }
    },
    // Drops the unspoken tail and stops the avatar; not awaited, since the stop waits for a
    // sentence still on its way to lipsync.
    onAbort: () => {
      forwarder?.stop()
    },
  })
}

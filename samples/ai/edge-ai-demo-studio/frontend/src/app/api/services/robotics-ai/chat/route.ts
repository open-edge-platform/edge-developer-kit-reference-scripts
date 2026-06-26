// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { createMCPClient } from '@ai-sdk/mcp'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { hermesToolMiddleware } from '@ai-sdk-tool/parser'
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  extractReasoningMiddleware,
  stepCountIs,
  streamText,
  wrapLanguageModel,
  type ToolSet,
  type UIMessage,
} from 'ai'
import { logger } from '@/lib/logger'
import { metaMap } from '@/services/_generated/meta'
import { getWorkloadModel } from '@/app/api/common/get-workload-model'

const SYSTEM_PROMPT = `You are a robotic arm AI assistant with vision and control capabilities.
You have access to tools to interact with the robot arm and analyze the live camera feed.

When to use tools:
- The user explicitly asks to pick up, grab, fetch, or retrieve a specific object → call the pickup_object tool with the object name.
- The user explicitly asks what you see, to describe the scene, or to identify objects → call the describe_scene tool.
`

export async function POST(req: Request) {
  const {
    messages,
    workerBaseUrl,
    toolId,
    language,
    useMcp = true,
  }: {
    messages: UIMessage[]
    workerBaseUrl: string
    toolId?: string
    language?: string
    useMcp?: boolean
  } = await req.json()

  if (!workerBaseUrl) {
    return new Response('workerBaseUrl is required', { status: 400 })
  }

  // Resolve relative workerBaseUrl (e.g. /api/robotics-ai) against the
  // request origin so server-side fetch calls get an absolute URL.
  const resolvedWorkerBaseUrl = workerBaseUrl.startsWith('/')
    ? `${new URL(req.url).origin}${workerBaseUrl}`
    : workerBaseUrl

  // Build the language suffix for the system prompt
  const langNote =
    language && language !== 'english' ? ` Respond in ${language}.` : ''
  const systemPrompt = SYSTEM_PROMPT + langNote

  // Connect to MCP server on the Python worker to expose robot control tools
  let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null = null
  let mcpTools: ToolSet = {}
  if (useMcp) {
    try {
      mcpClient = await createMCPClient({
        transport: {
          type: 'http',
          url: `${resolvedWorkerBaseUrl}/apps/mcp`,
        },
      })
      const allTools = await mcpClient.tools()
      // If a specific toolId is requested, expose only that tool
      if (toolId) {
        mcpTools = Object.fromEntries(
          Object.entries(allTools).filter(([name]) => name === toolId),
        ) as ToolSet
      } else {
        mcpTools = allTools
      }
    } catch (err) {
      logger.error('Failed to connect to MCP server:', err)
      // Proceed without tools
    }
  }

  // Use the internal text-generation service as the LLM backend (same as
  // digital avatar). This reuses the shared model and port config while
  // keeping robotics MCP tool integration local.
  const textGenMeta = metaMap['text-generation']
  if (!textGenMeta) {
    await mcpClient?.close()
    return new Response('Text-generation service not available', {
      status: 503,
    })
  }

  let model: string
  try {
    model = await getWorkloadModel(textGenMeta.id)
  } catch (error) {
    logger.error('Model service error:', error)
    await mcpClient?.close()
    return new Response('No available model', { status: 500 })
  }

  const hasMcpTools = Object.keys(mcpTools).length > 0

  // Match the text-generation provider setup exactly — pass tools through
  // to OVMS so hermes3 parser can set the correct finish_reason for tool calls.
  const provider = createOpenAICompatible({
    baseURL: `http://localhost:${textGenMeta.port}/v1`,
    name: 'ovms',
    fetch: async (url, options) => {
      if (options?.body) {
        const body = JSON.parse(options.body.toString())
        // Disable thinking when tools are present — thinking tokens
        // break the hermes3 tool parser in OVMS.
        if (hasMcpTools) {
          body.chat_template_kwargs = { enable_thinking: false }
        }
        options = { ...options, body: JSON.stringify(body) }
      }
      const newURL = new URL(url.toString())
      return fetch(newURL, options)
    },
  })

  const baseModel = provider(model)
  const wrappedModel = wrapLanguageModel({
    model: baseModel,
    middleware: hasMcpTools
      ? [hermesToolMiddleware, extractReasoningMiddleware({ tagName: 'think' })]
      : [extractReasoningMiddleware({ tagName: 'think' })],
  })

  const modelMessages = await convertToModelMessages(messages)

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const result = streamText({
        model: wrappedModel,
        system: systemPrompt,
        messages: modelMessages,
        ...(hasMcpTools ? { tools: mcpTools, stopWhen: stepCountIs(5) } : {}),
        onFinish: async () => {
          await mcpClient?.close()
        },
      })
      writer.merge(result.toUIMessageStream())
    },
  })

  return createUIMessageStreamResponse({ stream })
}

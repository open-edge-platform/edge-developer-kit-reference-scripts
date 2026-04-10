// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { createMCPClient } from '@ai-sdk/mcp'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type ToolSet,
  type UIMessage,
} from 'ai'
import { logger } from '@/lib/logger'

const SYSTEM_PROMPT = `You are a robotic arm AI assistant with vision and control capabilities.
You have access to tools to interact with the robot arm and analyze the live camera feed.

Reply rules:
- Always reply in markdown format.
- If you call a tool, explain your reasoning in the markdown text and how the tool output informs your final answer.
- If there is an image link, always use markdown to display the image.

Tool usage rules:
- When asked to pick up, grab, fetch, or retrieve an object → ALWAYS call the pickup_object tool with the object name.
- When asked what you see, to describe the scene, or about objects in the workspace → ALWAYS call the describe_scene tool.
- For all other questions, answer directly using the camera image context.

Always use the appropriate tool — never simulate or describe an action without executing it.`

// Dedicated model for MCP tool calling. Qwen3 has superior function-calling
// capability compared to the vision model used for plain chat.
const MCP_MODEL_ID = 'Qwen/Qwen3-4B-Instruct-2507'

export async function POST(req: Request) {
  const {
    messages,
    workerBaseUrl,
    toolId,
    language,
  }: {
    messages: UIMessage[]
    workerBaseUrl: string
    toolId?: string
    language?: string
  } = await req.json()

  if (!workerBaseUrl) {
    return new Response('workerBaseUrl is required', { status: 400 })
  }

  // Resolve relative workerBaseUrl (e.g. /api/robotics-ai) against the
  // request origin so server-side fetch calls get an absolute URL.
  const resolvedWorkerBaseUrl = workerBaseUrl.startsWith('/')
    ? `${new URL(req.url).origin}${workerBaseUrl}`
    : workerBaseUrl

  // Fetch LLM config from the Python worker
  let baseUrl: string
  let modelId: string
  try {
    const configRes = await fetch(`${resolvedWorkerBaseUrl}/client/config`)
    if (!configRes.ok) throw new Error(`HTTP ${configRes.status}`)
    const cfg = (await configRes.json()) as {
      base_url: string
      model_id: string
    }
    baseUrl = cfg.base_url
    modelId = cfg.model_id
  } catch (err) {
    logger.error('Failed to fetch robotics worker client config:', err)
    return new Response('Failed to reach robotics worker', { status: 502 })
  }

  // Fetch current camera snapshot (best-effort; skip if unavailable)
  let snapshotBase64: string | null = null
  try {
    const snapRes = await fetch(`${resolvedWorkerBaseUrl}/snapshot`)
    if (snapRes.ok) {
      const buf = await snapRes.arrayBuffer()
      snapshotBase64 = Buffer.from(buf).toString('base64')
    }
  } catch {
    // Camera may not be ready; proceed without frame
  }

  // Build the language suffix for the system prompt
  const langNote =
    language && language !== 'english' ? ` Respond in ${language}.` : ''
  const systemPrompt = SYSTEM_PROMPT + langNote

  // Connect to MCP server on the Python worker
  let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null = null
  let mcpTools: ToolSet = {}
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

  // Create the OpenAI-compatible provider using the worker's LLM config
  const provider = createOpenAICompatible({
    baseURL: baseUrl,
    name: 'robotics-llm',
  })

  // Use the base model directly — InternVL3 is a VLM, not a reasoning model,
  // so the extractReasoningMiddleware is not needed and can interfere with
  // function-call JSON in the response stream.
  // When MCP tools are present, switch to the dedicated tool-calling model.
  // Qwen3 is text-only, so the snapshot must NOT be injected in that case.
  const hasMcpTools = Object.keys(mcpTools).length > 0
  const resolvedModelId = hasMcpTools ? MCP_MODEL_ID : modelId
  const model = provider(resolvedModelId)

  // Build model messages and inject camera snapshot into the last user message.
  // Only inject when using the VLM — the text-only Qwen3 model rejects images.
  const modelMessages = await convertToModelMessages(messages)

  if (snapshotBase64 && !hasMcpTools) {
    for (let i = modelMessages.length - 1; i >= 0; i--) {
      const msg = modelMessages[i]
      if (msg.role === 'user') {
        const parts = Array.isArray(msg.content)
          ? [...msg.content]
          : [{ type: 'text' as const, text: String(msg.content) }]
        parts.push({
          type: 'image' as const,
          image: snapshotBase64,
          mediaType: 'image/jpeg',
        })
        modelMessages[i] = { ...msg, content: parts }
        break
      }
    }
  }

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const result = streamText({
        model,
        system: systemPrompt,
        messages: modelMessages,
        ...(Object.keys(mcpTools).length > 0
          ? { tools: mcpTools, stopWhen: stepCountIs(5) }
          : {}),
        onFinish: async () => {
          await mcpClient?.close()
        },
      })
      writer.merge(result.toUIMessageStream())
    },
  })

  return createUIMessageStreamResponse({ stream })
}

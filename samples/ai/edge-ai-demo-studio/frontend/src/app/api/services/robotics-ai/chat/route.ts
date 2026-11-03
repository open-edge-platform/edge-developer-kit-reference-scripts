// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { createMCPClient, type MCPClient } from '@ai-sdk/mcp'
import type { ToolSet, UIMessage } from 'ai'
import { z } from 'zod'
import { jsonErrorFrom, parseJsonBody } from '@/lib/api/json'
import { type ChatTools, streamChatResponse } from '@/lib/llm/chat-stream'
import { logger } from '@/lib/logger'
import { safeUrl, URL_CHARS } from '@/lib/validation'
import {
  boundInstanceKey,
  getWorkloadEndpoint,
  resolveWorkload,
} from '@/lib/workers/instance-lookup'
import {
  type WorkerRequestInit,
  untimedDispatcher,
} from '@/lib/workers/untimed-dispatcher'

const SYSTEM_PROMPT = `You are a robotic arm AI assistant with vision and control capabilities.
You have access to tools to interact with the robot arm and analyze the live camera feed.

When to use tools:
- The user explicitly asks to pick up, grab, fetch, or retrieve a specific object → call the pickup_object tool with the object name.
- The user explicitly asks what you see, to describe the scene, or to identify objects → call the describe_scene tool.
`

const chatBodySchema = z.object({
  messages: z.array(z.custom<UIMessage>((m) => !!m && typeof m === 'object')),
  /** Robotics AI instance (`robotics-ai@<id>`); the primary one when omitted. */
  instanceKey: z.string().nullish(),
  /** Instances the sample binds, by type; Text Generation falls back to the running one. */
  instances: z.record(z.string(), z.unknown()).nullish(),
  toolId: z.string().nullish(),
  language: z.string().nullish(),
  useMcp: z.boolean().nullish(),
})

/**
 * Loopback base URL of the robotics worker. The client names an instance, never an address, so a
 * request can't aim the MCP client at an arbitrary URL (SSRF). An absolute http(s)
 * `NEXT_PUBLIC_ROBOTICS_WORKER_URL` (build-time override) wins.
 */
async function resolveRoboticsWorker(
  instanceKey: string | undefined,
): Promise<string> {
  const override = process.env.NEXT_PUBLIC_ROBOTICS_WORKER_URL
  if (override && /^https?:\/\//i.test(override)) {
    return override.replace(/\/+$/, '')
  }
  return (await getWorkloadEndpoint('robotics-ai', instanceKey)).baseUrl
}

/** The worker's robot-control tools (only `toolId`, when given). */
async function connectRobotTools(
  workerBaseUrl: string,
  toolId: string | undefined,
): Promise<ChatTools | undefined> {
  let client: MCPClient | undefined
  try {
    client = await createMCPClient({
      transport: {
        type: 'http',
        url: `${workerBaseUrl}/apps/mcp`,
        // A pickup answers only when done, so no Node fetch 300 s cut-off; the chat's abort
        // signal bounds it instead.
        fetch: (url, init) => {
          const raw = String(url)
          let target = ''
          for (const ch of safeUrl(raw)) {
            let ok = ''
            for (const allowed of URL_CHARS)
              if (allowed === ch) {
                ok = allowed
                break
              }
            if (!ok) throw new Error('Forbidden character in URL')
            target += ok
          }
          return fetch(target, {
            ...init,
            dispatcher: untimedDispatcher,
          } as WorkerRequestInit)
        },
      },
    })
    const all = await client.tools()
    const tools: ToolSet = toolId
      ? Object.fromEntries(
          Object.entries(all).filter(([name]) => name === toolId),
        )
      : all
    const connected = client
    return { tools, cleanup: () => connected.close() }
  } catch (err) {
    // The chat goes on without tools.
    logger.error('Failed to connect to MCP server:', err)
    await client?.close().catch(() => undefined)
    return undefined
  }
}

export async function POST(req: Request) {
  const parsed = await parseJsonBody(req, chatBodySchema)
  if (!parsed.ok) return parsed.response
  const { messages, instances, language } = parsed.data

  let workerBaseUrl: string
  let textGen: { model: string; baseUrl: string }
  try {
    workerBaseUrl = await resolveRoboticsWorker(
      parsed.data.instanceKey || undefined,
    )
    // The internal Text Generation service is the LLM (the instance the
    // sample binds, else the running one); the robot's tools stay local.
    textGen = await resolveWorkload(
      'text-generation',
      boundInstanceKey(instances, 'text-generation'),
    )
  } catch (error) {
    return jsonErrorFrom(error, 'No available model', 'Robotics chat')
  }

  const tools =
    parsed.data.useMcp === false
      ? undefined
      : await connectRobotTools(workerBaseUrl, parsed.data.toolId ?? undefined)
  const hasTools = tools !== undefined && Object.keys(tools.tools).length > 0

  return streamChatResponse({
    ...textGen,
    messages,
    instructions:
      SYSTEM_PROMPT +
      (language && language !== 'english' ? ` Respond in ${language}.` : ''),
    abortSignal: req.signal,
    tools,
    parseReasoning: true,
    // Thinking tokens break the hermes3 tool parser in OVMS: turn thinking
    // off while tools are offered.
    patchBody: hasTools
      ? (request) => {
          request.chat_template_kwargs = { enable_thinking: false }
        }
      : undefined,
  })
}

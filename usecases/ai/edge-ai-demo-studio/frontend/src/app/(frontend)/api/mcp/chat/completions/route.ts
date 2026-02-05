// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { TEXT_GENERATION_PORT } from '@/lib/constants'
import { getMcpManager } from '@/lib/mcp-manager'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  convertToModelMessages,
  extractReasoningMiddleware,
  generateText,
  stepCountIs,
  streamText,
  ToolSet,
  UIMessage,
  wrapLanguageModel,
} from 'ai'
import { hermesToolMiddleware } from '@ai-sdk-tool/parser'
import { logger } from '@/utils/logger'
import { getWorkloadModel } from '@/utils/workload/service'
import { TEXT_GENERATION_TYPE } from '@/lib/workloads/text-generation'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// Union type to support both simple ChatMessage format and Vercel AI SDK UIMessage format
type MessageInput = ChatMessage | UIMessage

// Helper function to normalize and validate messages
function processMessages(messages: MessageInput[]) {
  try {
    // Try to use convertToModelMessages for UIMessage format
    const modelMessages = convertToModelMessages(messages as UIMessage[])
    return { success: true as const, messages: modelMessages }
  } catch {
    // Fallback to simple message validation for ChatMessage format
    const simpleMessages = messages as ChatMessage[]

    // Validate each message
    for (const message of simpleMessages) {
      if (!message.role || !message.content) {
        return {
          success: false as const,
          error: 'Each message must have both role and content properties.',
        }
      }
      if (!['system', 'user', 'assistant'].includes(message.role)) {
        return {
          success: false as const,
          error: 'Message role must be one of: system, user, assistant.',
        }
      }
    }

    // Convert to model message format
    const modelMessages = simpleMessages.map((msg) => ({
      role: msg.role as 'system' | 'user' | 'assistant',
      content: msg.content,
    }))

    return { success: true as const, messages: modelMessages }
  }
}

export async function POST(req: Request) {
  const {
    messages,
    tools = [],
    stream = false,
    maxSteps = 3,
  }: {
    messages: MessageInput[]
    tools?: string[]
    stream?: boolean
    maxSteps?: number
  } = await req.json()

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return Response.json(
      { error: 'Messages array is required and must not be empty.' },
      { status: 400 },
    )
  }

  // Process and validate messages (supports both ChatMessage and UIMessage formats)
  const messageResult = processMessages(messages)
  if (!messageResult.success) {
    return Response.json({ error: messageResult.error }, { status: 400 })
  }

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

  const wrappedModel = wrapLanguageModel({
    model: provider(model),
    middleware: [
      hermesToolMiddleware,
      extractReasoningMiddleware({ tagName: 'think' }),
    ],
  })

  // Get MCP tools from server-side manager
  let mcpTools: ToolSet = {}

  try {
    const mcpManager = getMcpManager()

    if (tools && tools.length > 0) {
      // Get specific tools by names
      mcpTools = await mcpManager.getToolsByNames(tools)
    } else {
      // Get all available tools when no specific tools requested
      mcpTools = await mcpManager.getAllTools()
    }
  } catch (error) {
    logger.error('Error loading MCP tools:', error)
    // Continue without tools rather than failing completely
  }

  try {
    // Use the processed messages from validation
    const formattedMessages = messageResult.messages!

    // Only enable tools if available
    const toolChoice =
      Object.keys(mcpTools).length > 0 ? ('auto' as const) : ('none' as const)

    const commonConfig = {
      model: wrappedModel,
      stopWhen: stepCountIs(maxSteps),
      toolChoice,
      tools: mcpTools,
      system:
        'You are a helpful, honest, and knowledgeable assistant. Keep your responses brief and conversational - typically 1-3 sentences unless the user specifically asks for more details. When you need information, gather it seamlessly with the provided tools if necessary and without mentioning the technical details of how you retrieve it.',
      messages: formattedMessages,
    }

    if (stream) {
      // Streaming response
      const response = streamText(commonConfig)
      return response.toUIMessageStreamResponse()
    } else {
      // Non-streaming response
      const response = await generateText(commonConfig)
      return Response.json({
        text: response.text,
        steps: response.steps,
        toolCalls: response.toolCalls,
        toolResults: response.toolResults,
        reasoning: response.reasoning,
        usage: response.usage,
        messages: formattedMessages, // Include the processed messages in response
      })
    }
  } catch (error) {
    logger.error('Error during text generation:', error)
    return Response.json(
      { error: 'An error occurred during text generation.' },
      { status: 500 },
    )
  }
}

// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { TEXT_GENERATION_PORT } from '@/lib/constants'
import { getMcpManager } from '@/lib/mcp-manager'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  extractReasoningMiddleware,
  generateText,
  stepCountIs,
  streamText,
  ToolSet,
  wrapLanguageModel,
} from 'ai'
import {
  hermesToolMiddleware,
  morphXmlToolMiddleware,
} from '@ai-sdk-tool/parser'
import { logger } from '@/utils/logger'
import { getWorkloadModel } from '@/utils/workload/service'
import { TEXT_GENERATION_TYPE } from '@/lib/workloads/text-generation'

export async function POST(req: Request) {
  const {
    prompt,
    tools = [],
    stream = false,
    maxSteps = 3,
  }: {
    prompt: string
    tools?: string[]
    stream?: boolean
    maxSteps?: number
  } = await req.json()

  if (!prompt) {
    return Response.json({ error: 'Prompt is required.' }, { status: 400 })
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

  const middleware = [extractReasoningMiddleware({ tagName: 'think' })]
  if (model.toLowerCase().includes('deepseek')) {
    middleware.unshift(morphXmlToolMiddleware)
  } else if (
    model.toLowerCase().includes('hermes') ||
    model.toLowerCase().includes('qwen') ||
    model.toLowerCase().includes('phi')
  ) {
    middleware.unshift(hermesToolMiddleware)
  }

  const wrappedModel = wrapLanguageModel({
    model: provider(model),
    middleware: middleware,
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
    // Convert prompt to messages format
    const formattedMessages = [{ role: 'user' as const, content: prompt }]

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
      const response = streamText({
        ...commonConfig,
      })
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
        model, // Include the model that was used
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

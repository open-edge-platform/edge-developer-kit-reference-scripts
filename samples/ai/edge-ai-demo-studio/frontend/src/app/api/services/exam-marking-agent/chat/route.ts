// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { convertToModelMessages, streamText, type UIMessage } from 'ai'
import { z } from 'zod'
import { jsonErrorFrom, parseJsonBody } from '@/lib/api/json'
import { getWorkloadEndpoint } from '@/lib/workers/instance-lookup'

const chatBodySchema = z.object({
  messages: z.array(z.custom<UIMessage>((m) => !!m && typeof m === 'object')),
})

/** Streams the Exam Marking Agent's reply; the agent picks its own LLM, so the model id is a placeholder. */
export async function POST(req: Request) {
  const parsed = await parseJsonBody(req, chatBodySchema)
  if (!parsed.ok) return parsed.response

  let baseUrl: string
  try {
    ;({ baseUrl } = await getWorkloadEndpoint('exam-marking-agent'))
  } catch (error) {
    return jsonErrorFrom(
      error,
      'Exam Marking Agent is not available',
      'Exam marking agent chat',
    )
  }

  const provider = createOpenAICompatible({
    name: 'exam-marking-agent',
    baseURL: `${baseUrl}/v1`,
    apiKey: process.env.EXAM_MARKING_API_KEY ?? '',
  })

  const result = streamText({
    model: provider('dummy'),
    messages: await convertToModelMessages(parsed.data.messages),
    abortSignal: req.signal,
  })

  return result.toUIMessageStreamResponse()
}

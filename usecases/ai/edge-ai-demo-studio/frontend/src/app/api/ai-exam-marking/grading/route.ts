// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, Output } from 'ai'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { metaMap } from '@/services/_generated/meta'
import { getWorkloadModel } from '@/app/api/common/get-workload-model'

export async function POST(request: Request) {
  try {
    const { prompt, answer } = await request.json()

    if (!prompt) {
      return Response.json({ error: 'No prompt provided' }, { status: 400 })
    }

    const textGenerationMeta = metaMap['text-generation']
    let model: string
    try {
      model = await getWorkloadModel(textGenerationMeta.id)
    } catch (error) {
      logger.error('Model service error:', error)
      return new Response('No available model', { status: 500 })
    }

    const provider = createOpenAICompatible({
      baseURL: `http://localhost:${textGenerationMeta.port}/v1`,
      name: 'llama.cpp',
    })

    const { output } = await generateText({
      model: provider(model),
      temperature: 0,
      output: Output.object({
        schema: z.object({
          student_answer: z.string(),
          feedback: z.string(),
          marks_awarded: z.number(),
          human_review: z.boolean(),
        }),
      }),
      messages: [
        {
          role: 'system',
          content: prompt,
        },
        {
          role: 'user',
          content: `Given the question and student answer, evaluate the student's answer:\n\n${answer ?? ''}`,
        },
      ],
    })

    return Response.json(output)
  } catch (error) {
    logger.error('LLM processing API error:', error)
    return Response.json(
      { error: 'Failed to process with LLM' },
      { status: 500 },
    )
  }
}

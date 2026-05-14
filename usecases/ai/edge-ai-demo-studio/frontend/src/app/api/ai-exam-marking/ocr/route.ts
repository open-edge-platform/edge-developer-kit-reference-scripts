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
    const { image, prompt } = await request.json()

    if (!image) {
      return Response.json({ error: 'No image provided' }, { status: 400 })
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
        schema: z.record(
          z.string(),
          z.object({ question: z.string(), answer: z.string() }),
        ),
      }),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              image: Buffer.from(image, 'base64'),
            },
            {
              type: 'text',
              text:
                prompt ||
                'Extract all questions and answers from the image as structured data.',
            },
          ],
        },
      ],
    })

    return Response.json(output)
  } catch (error) {
    logger.error('OCR API error:', error)
    return Response.json(
      { error: 'Failed to process image with VLM' },
      { status: 500 },
    )
  }
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { generateText, Output } from 'ai'
import { z } from 'zod'
import { jsonErrorFrom, parseJsonBody } from '@/lib/api/json'
import { createOvmsProvider } from '@/lib/llm/ovms-provider'
import {
  boundInstanceKey,
  resolveWorkload,
} from '@/lib/workers/instance-lookup'

const ocrBodySchema = z.object({
  /** The page as base64 (no data: prefix). */
  image: z.string().min(1, 'No image provided'),
  prompt: z.string().nullish(),
  instances: z.record(z.string(), z.unknown()).nullish(),
})

const ocrOutputSchema = z
  .object({
    student_name: z.string().optional(),
    student_id: z.string().optional(),
  })
  .catchall(z.object({ question: z.string(), answer: z.string() }))

/** Reads a scanned answer sheet into questions and answers with the VLM. */
export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, ocrBodySchema)
  if (!parsed.ok) return parsed.response
  const { image, prompt, instances } = parsed.data

  try {
    // The Text Generation instance the sample binds, else the running one.
    const { model, baseUrl } = await resolveWorkload(
      'text-generation',
      boundInstanceKey(instances, 'text-generation'),
    )
    const provider = createOvmsProvider({ baseUrl })

    const { output } = await generateText({
      model: provider(model),
      temperature: 0,
      output: Output.object({ schema: ocrOutputSchema }),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              mediaType: 'image',
              data: Buffer.from(image, 'base64'),
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
    return jsonErrorFrom(error, 'Failed to process image with VLM', 'OCR API')
  }
}

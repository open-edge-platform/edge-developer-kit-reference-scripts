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

const gradingBodySchema = z.object({
  /** The marking instructions: question, rubric, marks. */
  prompt: z.string().min(1, 'No prompt provided'),
  answer: z.string().nullish(),
  instances: z.record(z.string(), z.unknown()).nullish(),
})

const gradingOutputSchema = z.object({
  student_answer: z.string(),
  feedback: z.string(),
  marks_awarded: z.number(),
  human_review: z.boolean(),
})

/** Marks one answer against its rubric with the LLM. */
export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, gradingBodySchema)
  if (!parsed.ok) return parsed.response
  const { prompt, answer, instances } = parsed.data

  try {
    // The Text Generation instance the sample binds, else the running one.
    const { model, baseUrl } = await resolveWorkload(
      'text-generation',
      boundInstanceKey(instances, 'text-generation'),
    )
    // Sends the output schema as a json_schema response format, so the server constrains the reply.
    const provider = createOvmsProvider({
      baseUrl,
      supportsStructuredOutputs: true,
    })

    const { output } = await generateText({
      model: provider(model),
      temperature: 0,
      instructions: prompt,
      output: Output.object({ schema: gradingOutputSchema }),
      messages: [
        {
          role: 'user',
          content: `Evaluate the student's answer:\n\n${answer?.trim() ? answer : 'Empty answer'}`,
        },
      ],
    })

    return Response.json(output)
  } catch (error) {
    return jsonErrorFrom(error, 'Failed to process with LLM', 'Grading API')
  }
}

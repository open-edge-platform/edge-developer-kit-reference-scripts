// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { TEXT_GENERATION_PORT } from '@/lib/constants'
import OpenAI from 'openai'

export async function POST(req: Request) {
  const { prompt, model } = await req.json()
  if (!prompt || !model) {
    return Response.json(
      { error: 'Prompt and model are required.' },
      { status: 400 },
    )
  }

  const client = new OpenAI({
    baseURL: `http://localhost:${TEXT_GENERATION_PORT}/v3`,
    apiKey: '',
  })

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content:
          'You are a helpful, honest, and knowledgeable assistant. Always reply in English.',
      },
      { role: 'user', content: prompt },
    ],
  })

  return Response.json({ ...response })
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import config from '@payload-config'
import { getPayload } from 'payload'
import { engines } from '@/engines/registry'
import { logger } from '@/lib/logger'
import type { Service } from '@/payload-types'
import { metaMap } from '@/services/_generated/meta'

async function getWorkloadModel(
  workloadType: Service['type'],
): Promise<string> {
  const payload = await getPayload({ config })
  const textGenerationDoc = await payload.find({
    collection: 'services',
    where: { type: { equals: workloadType } },
    limit: 1,
  })

  if (textGenerationDoc.totalDocs < 1)
    return Promise.reject(`No ${workloadType} workload found`)

  const textGenerationWorkload = textGenerationDoc.docs[0]
  const selectedEngine = engines[textGenerationWorkload.engine]
  return selectedEngine.getModelName(
    textGenerationWorkload.models.default,
    true,
  )
}

export async function POST(req: Request) {
  const textGenerationMeta = metaMap['text-generation']

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json(
      { error: 'Invalid JSON in request body' },
      { status: 400 },
    )
  }

  let model: string
  try {
    model = await getWorkloadModel(textGenerationMeta.id)
  } catch (error) {
    logger.error('Model service error:', error)
    return Response.json({ error: 'No available model' }, { status: 500 })
  }

  try {
    const res = await fetch(
      `http://localhost:${textGenerationMeta.port}/v1/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, model }),
      },
    )

    if (!res.ok) {
      const text = await res.text()
      return new Response(text, {
        status: res.status,
        headers: {
          'Content-Type': res.headers.get('Content-Type') ?? 'text/plain',
        },
      })
    }

    const data = await res.json()
    return Response.json(data)
  } catch (error) {
    logger.error('Text generation completion error:', error)
    return Response.json(
      { error: 'Failed to reach text generation service' },
      { status: 502 },
    )
  }
}

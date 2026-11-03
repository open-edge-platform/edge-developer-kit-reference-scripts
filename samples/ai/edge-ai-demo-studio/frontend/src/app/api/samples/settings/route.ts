// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import config from '@payload-config'
import { type NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { z } from 'zod'
import { jsonError, parseJsonBody } from '@/lib/api/json'
import { isServiceType } from '@/lib/instances/service-type'
import {
  isServiceRowId,
  isValidSampleId,
  withSampleInstanceBinding,
} from '@/lib/settings/sample-settings'
import {
  readSampleInstanceBindings,
  writeSampleInstanceBindings,
} from '@/lib/settings/sample-settings-store'
import { metaMap } from '@/services/_generated/meta'

export const dynamic = 'force-dynamic'

/**
 * Which instance each sample uses per service type (the `sample-settings` global).
 * `GET` → `{ instances: { [sampleId]: { [type]: <services row id> } } }`. `PATCH { sampleId, type,
 * instance }` binds a row of `type` (`null`: back to automatic) and answers with the whole map.
 */
export async function GET() {
  const payload = await getPayload({ config })
  const instances = await readSampleInstanceBindings(payload)
  return NextResponse.json({ instances })
}

const bindingSchema = z.object({
  sampleId: z.string().refine(isValidSampleId, 'Invalid sample id'),
  type: z.string(),
  instance: z
    .number()
    .nullable()
    .refine((v) => v === null || isServiceRowId(v), {
      message: '"instance" must be a services row id or null',
    }),
})

export async function PATCH(request: NextRequest) {
  const parsed = await parseJsonBody(request, bindingSchema)
  if (!parsed.ok) return parsed.response
  const { sampleId, type, instance } = parsed.data

  if (!isServiceType(type)) return jsonError(400, 'Unknown service type')
  const meta = metaMap[type]

  const payload = await getPayload({ config })
  if (instance !== null) {
    const row = await payload.findByID({
      collection: 'services',
      id: instance,
      disableErrors: true,
    })
    if (!row || row.type !== type) {
      return jsonError(404, `No ${meta.name} instance with id ${instance}`)
    }
  }

  const current = await readSampleInstanceBindings(payload)
  const next = withSampleInstanceBinding(current, sampleId, type, instance)
  await writeSampleInstanceBindings(payload, next)
  return NextResponse.json({ instances: next })
}

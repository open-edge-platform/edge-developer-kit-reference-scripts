// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import config from '@payload-config'
import { type NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { z } from 'zod'
import { jsonErrorFrom, parseJsonBody } from '@/lib/api/json'
import { getInstanceProcessName } from '@/lib/instances/instances'
import { appliedConfigOf } from '@/lib/workers/applied-config'
import { createInstance } from '@/lib/workers/instance-operations'
import { getStartupTelemetry } from '@/lib/workers/startup-telemetry'

export const dynamic = 'force-dynamic'

/**
 * Every instance row, oldest first, with in-memory runtime fields: `applied` (what the running
 * process was started with) and `startup` (what the current or failed start reported).
 */
export async function GET() {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'services',
    pagination: false,
    sort: 'id',
  })
  return NextResponse.json(
    result.docs.map((doc) => ({
      ...doc,
      applied: appliedConfigOf(doc),
      startup: getStartupTelemetry(getInstanceProcessName(doc), doc.status),
    })),
  )
}

const objectField = z.record(z.string(), z.unknown())

/** `POST /api/services` — see `createInstance` for what each field does. */
const createInstanceSchema = z.object({
  type: z.string({ error: 'Unknown service type' }),
  label: z.string().default(''),
  instanceId: z.string().optional(),
  copyFrom: z.number().int().nullish(),
  model: objectField.optional(),
  metadata: objectField.optional(),
  config: objectField.optional(),
  engine: z.string().optional(),
  autostart: z.boolean().optional(),
})

/** Adds an instance (201 with the new row). */
export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody(request, createInstanceSchema)
  if (!parsed.ok) return parsed.response
  try {
    const payload = await getPayload({ config })
    const created = await createInstance(payload, {
      ...parsed.data,
      copyFrom: parsed.data.copyFrom ?? undefined,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    return jsonErrorFrom(error, 'Failed to create instance')
  }
}

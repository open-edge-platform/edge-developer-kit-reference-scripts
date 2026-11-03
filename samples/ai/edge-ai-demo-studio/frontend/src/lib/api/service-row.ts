// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import config from '@payload-config'
import { getPayload } from 'payload'
import { ApiError } from '@/lib/api/errors'
import { jsonErrorFrom } from '@/lib/api/json'
import type { Service } from '@/payload-types'

export interface ServiceRow {
  payload: Awaited<ReturnType<typeof getPayload>>
  service: Service
}

/** Loads the row a `services/[id]` param names; `ApiError` 400 for a bad id, 404 when missing. */
async function resolveServiceRow(id: string): Promise<ServiceRow> {
  const numericId = Number(id)
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new ApiError(400, 'Invalid service ID')
  }

  const payload = await getPayload({ config })
  // Otherwise Payload throws its own NotFound, which would surface as a 500.
  const service = await payload.findByID({
    collection: 'services',
    id: numericId,
    disableErrors: true,
  })
  if (!service) throw new ApiError(404, 'Service not found')
  return { payload, service }
}

/** Runs a `services/[id]` handler with its row; errors answer via `jsonErrorFrom` with `failure`. */
export async function withServiceRow(
  params: Promise<{ id: string }>,
  failure: string,
  handle: (row: ServiceRow) => Promise<Response>,
): Promise<Response> {
  try {
    return await handle(await resolveServiceRow((await params).id))
  } catch (error) {
    return jsonErrorFrom(error, failure)
  }
}

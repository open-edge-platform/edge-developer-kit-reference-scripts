// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseJsonBody } from '@/lib/api/json'
import { withServiceRow } from '@/lib/api/service-row'
import { logger } from '@/lib/logger'
import { SERVICE_ACTIONS } from '@/lib/instances/service-status'
import {
  applyInstanceAction,
  configureInstance,
  renameInstance,
  switchInstanceEngine,
} from '@/lib/workers/instance-operations'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Exactly one change per request: `action`, `config` (Configure panel), `label` (rename; the
 * address stays) or `engine`.
 */
const patchSchema = z.union(
  [
    z.object({ action: z.enum(SERVICE_ACTIONS) }).strict(),
    z.object({ config: z.record(z.string(), z.unknown()) }).strict(),
    z.object({ label: z.string() }).strict(),
    z.object({ engine: z.string() }).strict(),
  ],
  {
    error: `Invalid request. Send exactly one of 'action' (${SERVICE_ACTIONS.join(', ')}), 'config', 'label' or 'engine'.`,
  },
)

export async function PATCH(request: NextRequest, { params }: Params) {
  const parsed = await parseJsonBody(request, patchSchema)
  if (!parsed.ok) return parsed.response
  const change = parsed.data

  return withServiceRow(
    params,
    'Failed to update the instance',
    async ({ payload, service }) => {
      if ('action' in change) {
        return NextResponse.json(
          await applyInstanceAction(payload, service, change.action),
        )
      }
      if ('config' in change) {
        return NextResponse.json(
          await configureInstance(payload, service, change.config),
        )
      }
      if ('label' in change) {
        return NextResponse.json(
          await renameInstance(payload, service, change.label),
        )
      }
      return NextResponse.json(
        await switchInstanceEngine(payload, service, change.engine),
      )
    },
  )
}

/**
 * Deletes an instance. A service is only its rows, so deleting the last one removes the service;
 * added again, it starts from its defaults.
 */
export function DELETE(_request: NextRequest, { params }: Params) {
  return withServiceRow(
    params,
    'Failed to delete the instance',
    async ({ payload, service }) => {
      // The afterDelete hook stops the instance's process and removes its data.
      await payload.delete({ collection: 'services', id: service.id })
      logger.log(`🗑️  Deleted ${service.type} instance "${service.instanceId}"`)
      return new NextResponse(null, { status: 204 })
    },
  )
}

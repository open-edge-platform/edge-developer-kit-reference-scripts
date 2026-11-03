// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// The `@payload-config`-bearing import goes first, before the engine handler, so the route
// stays safe should the engine registry ever read a handler at load time.
import { withServiceRow } from '@/lib/api/service-row'
import { after, type NextRequest, NextResponse } from 'next/server'
import {
  ensureMultiserveEngine,
  getMultiserveEngineState,
} from '@/engines/multiserve/process-handler'
import { jsonError } from '@/lib/api/json'
import { logger } from '@/lib/logger'
import { ensureInstancePort } from '@/lib/workers/instance-ports'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const notMultiserve = () =>
  jsonError(400, 'Engine start is only supported for multiserve services')

/**
 * Starts the instance's multiserve engine (no model) and answers 202 at once, since the start can
 * take minutes; follow it with GET. A full port range answers 409.
 */
export function POST(_request: NextRequest, { params }: Params) {
  return withServiceRow(
    params,
    'Failed to start the engine',
    async ({ payload, service }) => {
      if (service.engine !== 'multiserve') return notMultiserve()

      // Services own no port while stopped — pick one from the range.
      const withPort = await ensureInstancePort(payload, service)

      // Registered as in progress before this returns, so a GET right after
      // already reads `starting`; concurrent POSTs share the one start.
      const started = ensureMultiserveEngine(withPort)
        .then((ok) => {
          if (!ok) logger.error(`Engine for ${service.name} did not start`)
          return ok
        })
        .catch((error) => {
          logger.error(`Error starting the engine for ${service.name}:`, error)
          return false
        })
      after(started)

      return NextResponse.json({ ok: true, starting: true }, { status: 202 })
    },
  )
}

/** `{ starting, healthy }` — where a start from POST stands. */
export function GET(_request: NextRequest, { params }: Params) {
  return withServiceRow(
    params,
    'Failed to read the engine state',
    async ({ service }) => {
      if (service.engine !== 'multiserve') return notMultiserve()
      return NextResponse.json(await getMultiserveEngineState(service))
    },
  )
}

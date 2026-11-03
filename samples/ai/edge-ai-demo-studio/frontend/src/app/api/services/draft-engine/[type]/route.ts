// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// The `@payload-config`-bearing import first, before the engine handler —
// see the note in `../../[id]/engine/route.ts`.
import config from '@payload-config'
import { after, type NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import {
  getDraftEngineState,
  reserveDraftEnginePort,
  startDraftEngine,
  stopDraftEngine,
} from '@/engines/multiserve/draft-engine'
import { jsonError, jsonErrorFrom } from '@/lib/api/json'
import { isServiceType } from '@/lib/instances/service-type'
import type { Service } from '@/payload-types'
import { metaMap } from '@/services/_generated/meta'
import { hasExecutionMode } from '@/services/execution'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ type: string }> }

function isDraftEngineType(type: string): type is Service['type'] {
  return (
    isServiceType(type) &&
    hasExecutionMode(metaMap[type].execution, 'multiserve')
  )
}

const unsupported = (type: string) =>
  jsonError(400, `"${type}" is not a service that runs on multiserve`)

/**
 * Starts the type's draft engine and answers 202 once its port is reserved (409 when the range is
 * full); follow the start with GET.
 */
export async function POST(_request: NextRequest, { params }: Params) {
  const { type } = await params
  if (!isDraftEngineType(type)) return unsupported(type)

  try {
    const port = await reserveDraftEnginePort(
      await getPayload({ config }),
      type,
    )
    // Registered as in progress before this returns, so a GET right after
    // already reads `starting`.
    after(startDraftEngine(type, port))
    return NextResponse.json({ ok: true, starting: true }, { status: 202 })
  } catch (error) {
    return jsonErrorFrom(error, 'Failed to start the draft engine')
  }
}

/** `{ starting, healthy }` — where a start from POST stands. */
export async function GET(_request: NextRequest, { params }: Params) {
  const { type } = await params
  if (!isDraftEngineType(type)) return unsupported(type)
  return NextResponse.json(await getDraftEngineState(type))
}

/** Stops the draft engine; answers at once and stops in the background. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { type } = await params
  if (!isDraftEngineType(type)) return unsupported(type)
  after(stopDraftEngine(type))
  return NextResponse.json({ ok: true }, { status: 202 })
}

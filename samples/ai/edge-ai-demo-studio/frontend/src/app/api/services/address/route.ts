// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/api/json'
import { isServiceType } from '@/lib/instances/service-type'
import { getInstanceApiBase, getInstanceKey } from '@/lib/instances/instances'
import { findPrimaryInstance } from '@/lib/workers/instance-lookup'
import { metaMap } from '@/services/_generated/meta'

export const dynamic = 'force-dynamic'

/**
 * The address of a type's running instance (else its first), for a caller that knows only the
 * type, such as a worker calling a sibling: `?type=frame-generation` →
 * `{ type, instanceKey, address: "/api/frame-generation@frame-generation" }`.
 */
export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get('type')
  if (!isServiceType(type)) return jsonError(400, 'Unknown service type')
  const meta = metaMap[type]

  const row = await findPrimaryInstance(type)
  if (!row) return jsonError(404, `${meta.name} is not added yet`)

  return NextResponse.json({
    type,
    instanceKey: getInstanceKey(row),
    address: getInstanceApiBase(row),
  })
}

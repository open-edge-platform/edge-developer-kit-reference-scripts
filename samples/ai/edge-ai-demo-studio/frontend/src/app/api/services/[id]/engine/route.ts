// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import config from '@payload-config'
import { type NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { ensureMultiserveEngine } from '@/engines/multiserve/process-handler'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const numericId = Number(id)
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: 'Invalid service ID' }, { status: 400 })
  }

  const payload = await getPayload({ config })

  const service = await payload.findByID({
    collection: 'services',
    id: numericId,
  })

  if (!service) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 })
  }

  if (service.engine !== 'multiserve') {
    return NextResponse.json(
      { error: 'Engine start is only supported for multiserve services' },
      { status: 400 },
    )
  }

  const started = await ensureMultiserveEngine(service)

  return NextResponse.json({ ok: started })
}

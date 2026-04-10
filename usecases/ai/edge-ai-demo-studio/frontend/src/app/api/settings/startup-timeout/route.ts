// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import config from '@payload-config'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

export const dynamic = 'force-dynamic'

export async function GET() {
  const payload = await getPayload({ config })
  const settings = await payload.findGlobal({
    slug: 'app-settings',
    overrideAccess: true,
  })
  return NextResponse.json({ startupTimeout: settings.startupTimeout ?? 600 })
}

export async function POST(request: Request) {
  const body = await request.json()
  const value =
    typeof body.startupTimeout === 'number' ? body.startupTimeout : 600
  const clamped = Math.max(30, Math.round(value))
  const payload = await getPayload({ config })
  await payload.updateGlobal({
    slug: 'app-settings',
    data: { startupTimeout: clamped },
  })
  return NextResponse.json({ success: true })
}

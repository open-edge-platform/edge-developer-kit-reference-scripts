// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import config from '@payload-config'
import { getActiveProxyTimeout } from '@/lib/active-proxy-timeout'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

export const dynamic = 'force-dynamic'

export async function GET() {
  const payload = await getPayload({ config })
  const settings = await payload.findGlobal({
    slug: 'app-settings',
    overrideAccess: true,
  })
  return NextResponse.json({
    proxyTimeout: settings.proxyTimeout ?? 30,
    activeProxyTimeout: await getActiveProxyTimeout(),
  })
}

export async function POST(request: Request) {
  const body = await request.json()
  const value = typeof body.proxyTimeout === 'number' ? body.proxyTimeout : 30
  const clamped = Math.max(30, Math.round(value))
  const payload = await getPayload({ config })
  await payload.updateGlobal({
    slug: 'app-settings',
    data: { proxyTimeout: clamped },
  })
  return NextResponse.json({ success: true })
}

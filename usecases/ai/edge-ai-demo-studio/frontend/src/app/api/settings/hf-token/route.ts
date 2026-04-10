// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import config from '@payload-config'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

export const dynamic = 'force-dynamic'

export async function GET() {
  const payload = await getPayload({ config })
  // overrideAccess needed so the field (read: false) is returned to trusted server code.
  const settings = await payload.findGlobal({
    slug: 'app-settings',
    overrideAccess: true,
  })
  const token = settings.hfToken
  return NextResponse.json({ hfToken: token ? '••••••••' : '' })
}

export async function POST(request: Request) {
  const body = await request.json()
  const token = typeof body.hfToken === 'string' ? body.hfToken : ''
  const payload = await getPayload({ config })
  await payload.updateGlobal({ slug: 'app-settings', data: { hfToken: token } })
  return NextResponse.json({ success: true })
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import config from '@payload-config'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import type { Theme } from '@/context/settings-context'

export const dynamic = 'force-dynamic'

const VALID_THEMES: Theme[] = ['light', 'dark', 'system']

export async function GET() {
  const payload = await getPayload({ config })
  const settings = await payload.findGlobal({
    slug: 'app-settings',
    overrideAccess: true,
  })
  const theme: Theme = VALID_THEMES.includes(settings.theme as Theme)
    ? (settings.theme as Theme)
    : 'system'
  return NextResponse.json({ theme })
}

export async function POST(request: Request) {
  const body = await request.json()
  const theme: Theme = VALID_THEMES.includes(body.theme) ? body.theme : 'system'
  const payload = await getPayload({ config })
  await payload.updateGlobal({ slug: 'app-settings', data: { theme } })
  return NextResponse.json({ success: true })
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonErrorFrom, parseJsonBody } from '@/lib/api/json'
import {
  readAppSettings,
  updateAppSettings,
} from '@/lib/settings/app-settings-store'

export const dynamic = 'force-dynamic'

/** `{ hasToken }` — the token itself never leaves the server. */
export async function GET() {
  try {
    const settings = await readAppSettings()
    return NextResponse.json({ hasToken: Boolean(settings.hfToken) })
  } catch (error) {
    return jsonErrorFrom(
      error,
      'The settings could not be read from the database.',
      'Failed to read the HF token status',
    )
  }
}

/** `{ hfToken }` saves the token; an empty string removes it. */
const hfTokenSchema = z.object({ hfToken: z.string().trim() })

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, hfTokenSchema)
  if (!parsed.ok) return parsed.response
  try {
    await updateAppSettings({ hfToken: parsed.data.hfToken })
  } catch (error) {
    return jsonErrorFrom(
      error,
      'The settings database did not accept the change.',
      'Failed to save the HF token',
    )
  }
  return NextResponse.json({ success: true })
}

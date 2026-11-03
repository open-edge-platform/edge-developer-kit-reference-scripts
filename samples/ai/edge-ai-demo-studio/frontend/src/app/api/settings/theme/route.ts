// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonErrorFrom, parseJsonBody } from '@/lib/api/json'
import {
  APP_SETTINGS_DEFAULTS,
  isTheme,
  type Theme,
  THEMES,
} from '@/lib/settings/app-settings'
import {
  readAppSettings,
  updateAppSettings,
} from '@/lib/settings/app-settings-store'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const settings = await readAppSettings()
    const theme: Theme = isTheme(settings.theme)
      ? settings.theme
      : APP_SETTINGS_DEFAULTS.theme
    return NextResponse.json({ theme })
  } catch (error) {
    return jsonErrorFrom(
      error,
      'The settings could not be read from the database.',
      'Failed to read the theme',
    )
  }
}

/** `{ theme }`: one of the themes; anything else is a 400, not a reset. */
const themeSchema = z.object({ theme: z.enum(THEMES) })

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, themeSchema)
  if (!parsed.ok) return parsed.response
  try {
    await updateAppSettings({ theme: parsed.data.theme })
  } catch (error) {
    return jsonErrorFrom(
      error,
      'The settings database did not accept the change.',
      'Failed to save the theme',
    )
  }
  return NextResponse.json({ success: true })
}

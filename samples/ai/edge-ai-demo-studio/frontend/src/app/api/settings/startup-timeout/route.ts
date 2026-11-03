// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonErrorFrom, parseJsonBody } from '@/lib/api/json'
import {
  APP_SETTINGS_DEFAULTS,
  clampTimeout,
} from '@/lib/settings/app-settings'
import {
  readAppSettings,
  updateAppSettings,
} from '@/lib/settings/app-settings-store'

export const dynamic = 'force-dynamic'

const DEFAULT = APP_SETTINGS_DEFAULTS.startupTimeout

export async function GET() {
  try {
    const settings = await readAppSettings()
    return NextResponse.json({
      startupTimeout: settings.startupTimeout ?? DEFAULT,
    })
  } catch (error) {
    return jsonErrorFrom(
      error,
      'The settings could not be read from the database.',
      'Failed to read the startup timeout',
    )
  }
}

/** `{ startupTimeout }` in seconds, held at or above the minimum. */
const startupTimeoutSchema = z.object({ startupTimeout: z.number().finite() })

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, startupTimeoutSchema)
  if (!parsed.ok) return parsed.response
  try {
    await updateAppSettings({
      startupTimeout: clampTimeout(parsed.data.startupTimeout, DEFAULT),
    })
  } catch (error) {
    return jsonErrorFrom(
      error,
      'The settings database did not accept the change.',
      'Failed to save the startup timeout',
    )
  }
  return NextResponse.json({ success: true })
}

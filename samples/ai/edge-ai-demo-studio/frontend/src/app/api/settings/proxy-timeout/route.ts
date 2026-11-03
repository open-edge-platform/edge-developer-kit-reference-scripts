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

/**
 * `{ proxyTimeout, activeProxyTimeout }`, always equal since the proxy reads the saved value per
 * request; `activeProxyTimeout` stays for clients that still read it.
 */
export async function GET() {
  try {
    const settings = await readAppSettings()
    const proxyTimeout =
      settings.proxyTimeout ?? APP_SETTINGS_DEFAULTS.proxyTimeout
    return NextResponse.json({ proxyTimeout, activeProxyTimeout: proxyTimeout })
  } catch (error) {
    return jsonErrorFrom(
      error,
      'The settings could not be read from the database.',
      'Failed to read the proxy timeout',
    )
  }
}

/** `{ proxyTimeout }` in seconds, held at or above the minimum. */
const proxyTimeoutSchema = z.object({ proxyTimeout: z.number().finite() })

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, proxyTimeoutSchema)
  if (!parsed.ok) return parsed.response
  try {
    await updateAppSettings({
      proxyTimeout: clampTimeout(
        parsed.data.proxyTimeout,
        APP_SETTINGS_DEFAULTS.proxyTimeout,
      ),
    })
  } catch (error) {
    return jsonErrorFrom(
      error,
      'The settings database did not accept the change.',
      'Failed to save the proxy timeout',
    )
  }
  return NextResponse.json({ success: true })
}

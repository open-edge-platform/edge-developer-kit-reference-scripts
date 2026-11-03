// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import config from '@payload-config'
import { getPayload } from 'payload'
import { logger } from '@/lib/logger'
import type { AppSetting } from '@/payload-types'

/**
 * Server-side read of the `app-settings` global. `overrideAccess` is required: `hfToken` is
 * `read: false` (kept out of API responses), and without it the token silently goes missing.
 */
export async function readAppSettings(): Promise<AppSetting> {
  const payload = await getPayload({ config })
  return payload.findGlobal({ slug: 'app-settings', overrideAccess: true })
}

/** `{}` (defaults) when the database cannot be read; logged, since workers then lack the HF token. */
export async function readAppSettingsSafe(): Promise<Partial<AppSetting>> {
  try {
    return await readAppSettings()
  } catch (error) {
    logger.warn('Could not read the app settings, using defaults:', error)
    return {}
  }
}

export async function updateAppSettings(
  data: Partial<Omit<AppSetting, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<void> {
  const payload = await getPayload({ config })
  await payload.updateGlobal({ slug: 'app-settings', data })
}

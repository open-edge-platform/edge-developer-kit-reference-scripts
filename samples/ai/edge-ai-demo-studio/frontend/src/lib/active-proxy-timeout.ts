// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import config from '@payload-config'
import { getPayload } from 'payload'

// Cached once per Next.js server process (on first call) — survives page refreshes/tab closes.
// Only changes when the Next.js server process restarts (which is when
// next.config.ts re-reads the value and applies it to proxyTimeout).
const GLOBAL_KEY = '__activeProxyTimeout__'

export async function getActiveProxyTimeout(): Promise<number> {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: number }
  if (g[GLOBAL_KEY] === undefined) {
    try {
      const payload = await getPayload({ config })
      const settings = await payload.findGlobal({
        slug: 'app-settings',
        overrideAccess: true,
      })
      g[GLOBAL_KEY] = settings.proxyTimeout ?? 300
    } catch {
      return 300
    }
  }
  return g[GLOBAL_KEY]
}

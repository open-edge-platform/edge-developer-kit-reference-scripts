// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useSyncExternalStore } from 'react'
import type { ExternalStore } from '@/lib/browser/external-store'

/**
 * The current value of an {@link ExternalStore}, re-rendering when it
 * changes. `serverValue` is what the server render (and hydration) sees;
 * it defaults to the store's value at the time of the call.
 */
export function useExternalStore<T>(
  store: ExternalStore<T>,
  serverValue: T = store.get(),
): T {
  return useSyncExternalStore(store.subscribe, store.get, () => serverValue)
}

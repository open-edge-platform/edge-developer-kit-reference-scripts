// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * One value per server process, kept on `globalThis`: `next dev` bundles each route separately and
 * hot reload re-evaluates modules, so module-level state would otherwise exist once per copy.
 */
export function globalSingleton<T>(key: string, init: () => T): T {
  const store = globalThis as unknown as Record<string, unknown>
  if (store[key] === undefined) store[key] = init()
  return store[key] as T
}

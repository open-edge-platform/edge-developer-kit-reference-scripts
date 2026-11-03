// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** A value outside React, read with `useExternalStore`; subscribers re-render only on a real change. */
export interface ExternalStore<T> {
  get: () => T
  set: (next: T | ((prev: T) => T)) => void
  subscribe: (listener: () => void) => () => void
}

export function createExternalStore<T>(initial: T): ExternalStore<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next) => {
      const resolved =
        typeof next === 'function' ? (next as (prev: T) => T)(value) : next
      if (Object.is(resolved, value)) return
      value = resolved
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

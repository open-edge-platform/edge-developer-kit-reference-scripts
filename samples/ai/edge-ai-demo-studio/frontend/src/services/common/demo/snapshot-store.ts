// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useSyncExternalStore } from 'react'
import {
  createExternalStore,
  type ExternalStore,
} from '@/lib/browser/external-store'

/**
 * Base for an object keeping state outside React (a job follower, a stream, a player), read through
 * `useStoreSnapshot`. Subclasses replace the immutable snapshot via `setSnapshot`/`patchSnapshot`.
 */
export class SnapshotStore<T> {
  private readonly store: ExternalStore<T>

  constructor(initial: T) {
    this.store = createExternalStore(initial)
  }

  readonly subscribe = (listener: () => void): (() => void) =>
    this.store.subscribe(listener)

  readonly getSnapshot = (): T => this.store.get()

  protected get snapshot(): T {
    return this.store.get()
  }

  /**
   * Replaces the snapshot (a no-op when unchanged). `onSnapshotChange` runs first, so a subclass can
   * report derived changes before views re-read.
   */
  protected setSnapshot(next: T): void {
    const previous = this.store.get()
    if (Object.is(next, previous)) return
    this.onSnapshotChange(previous, next)
    this.store.set(() => next)
  }

  protected patchSnapshot(patch: Partial<T>): void {
    this.setSnapshot({ ...this.store.get(), ...patch })
  }

  /** Hook for subclasses: called on every change, before subscribers. */
  protected onSnapshotChange(_previous: T, _next: T): void {}
}

const noopSubscribe = () => () => {}

/** The snapshot of `store`, kept current; with no store yet, `fallback` (must be a stable value). */
export function useStoreSnapshot<T>(store: SnapshotStore<T>): T
export function useStoreSnapshot<T, F>(
  store: SnapshotStore<T> | null | undefined,
  fallback: F,
): T | F
export function useStoreSnapshot<T, F>(
  store: SnapshotStore<T> | null | undefined,
  fallback?: F,
): T | F | undefined {
  const getFallback = () => fallback
  return useSyncExternalStore<T | F | undefined>(
    store?.subscribe ?? noopSubscribe,
    store?.getSnapshot ?? getFallback,
    store?.getSnapshot ?? getFallback,
  )
}

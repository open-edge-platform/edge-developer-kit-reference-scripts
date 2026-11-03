// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  createContext,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

/**
 * In-memory demo state for one service page visit. The page remounts a demo per selected instance,
 * so values here come back on return and work started on one instance keeps running. Not persisted.
 */
class DemoSessionStore {
  private values = new Map<string, unknown>()
  /** Release of each session-owned value, by the value: added once. */
  private disposers = new Map<unknown, () => void>()
  private busy = new Set<string>()
  private busySnapshot: ReadonlySet<string> = new Set()
  private leaveNotices = new Map<string, string>()
  private leaveSnapshot: ReadonlyMap<string, string> = new Map()
  private listeners = new Set<() => void>()
  private disposeTimer: ReturnType<typeof setTimeout> | undefined

  has(key: string) {
    return this.values.has(key)
  }

  get(key: string) {
    return this.values.get(key)
  }

  set(key: string, value: unknown) {
    this.values.set(key, value)
  }

  /** Releases `owner` with the session; a second call for it is a no-op. */
  addDisposer(owner: unknown, dispose: () => void) {
    if (!this.disposers.has(owner)) this.disposers.set(owner, dispose)
  }

  setBusy(instanceKey: string, busy: boolean) {
    if (this.busy.has(instanceKey) === busy) return
    if (busy) this.busy.add(instanceKey)
    else this.busy.delete(instanceKey)
    this.busySnapshot = new Set(this.busy)
    this.emit()
  }

  setLeaveNotice(instanceKey: string, notice: string | null) {
    if ((this.leaveNotices.get(instanceKey) ?? null) === notice) return
    if (notice === null) this.leaveNotices.delete(instanceKey)
    else this.leaveNotices.set(instanceKey, notice)
    this.leaveSnapshot = new Map(this.leaveNotices)
    this.emit()
  }

  private emit() {
    this.listeners.forEach((listener) => listener())
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getBusy = () => this.busySnapshot

  getLeaveNotices = () => this.leaveSnapshot

  /** Cancels a scheduled dispose, so a development Strict Mode remount keeps the session. */
  retain() {
    clearTimeout(this.disposeTimer)
  }

  scheduleDispose() {
    this.disposeTimer = setTimeout(() => this.dispose(), 0)
  }

  private dispose() {
    const disposers = [...this.disposers.values()]
    this.disposers.clear()
    this.values.clear()
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // One failed release must not keep the rest.
      }
    }
  }
}

const DemoSessionContext = createContext<DemoSessionStore | null>(null)

const EMPTY_BUSY: ReadonlySet<string> = new Set()
const EMPTY_NOTICES: ReadonlyMap<string, string> = new Map()
const noopSubscribe = () => () => {}
const getEmptyBusy = () => EMPTY_BUSY
const getEmptyNotices = () => EMPTY_NOTICES

export function DemoSessionProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new DemoSessionStore())
  useEffect(() => {
    store.retain()
    return () => store.scheduleDispose()
  }, [store])
  return (
    <DemoSessionContext.Provider value={store}>
      {children}
    </DemoSessionContext.Provider>
  )
}

/**
 * `useState` that survives remounts under a `DemoSessionProvider`. `key` names the state and its
 * instance (see `demoStateKey`) and is read once on mount; without a provider or key, plain state.
 */
export function useSessionState<T>(
  key: string | undefined,
  initial: T | (() => T),
): [T, (next: SetStateAction<T>) => void] {
  const store = useContext(DemoSessionContext)
  const [value, setValue] = useState<T>(() =>
    store && key !== undefined && store.has(key)
      ? (store.get(key) as T)
      : typeof initial === 'function'
        ? (initial as () => T)()
        : initial,
  )

  useEffect(() => {
    if (store && key !== undefined) store.set(key, value)
  }, [store, key, value])

  return [value, setValue]
}

/**
 * An object created once per `key` that outlives remounts (a conversation, a job follower). It goes
 * to `dispose` (at most once) when the session ends, or on unmount without a provider. `create` must
 * not start anything: a development Strict Mode render may drop its result. One owner per key.
 */
export function useSessionResource<T>(
  key: string | undefined,
  create: () => T,
  dispose: (value: T) => void,
): T {
  const store = useContext(DemoSessionContext)
  const [value] = useState<T>(() =>
    store && key !== undefined && store.has(key)
      ? (store.get(key) as T)
      : create(),
  )

  // Without a session: released on unmount, deferred so a Strict Mode remount keeps it. `dispose`
  // is read when the value goes, so a new function identity each render does not release it.
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  const releaseValue = useEffectEvent(() => dispose(value))
  useEffect(() => {
    if (store && key !== undefined) {
      if (!store.has(key)) store.set(key, value)
      // Also a value that lost the race for the key: the session still releases it.
      store.addDisposer(value, () => releaseValue())
      return
    }
    clearTimeout(releaseTimer.current)
    return () => {
      releaseTimer.current = setTimeout(releaseValue, 0)
    }
  }, [store, key, value])

  return value
}

/** Marks an instance as having demo work in flight; a no-op outside a `DemoSessionProvider`. */
export function useSetSessionBusy(): (
  instanceKey: string,
  busy: boolean,
) => void {
  const store = useContext(DemoSessionContext)
  return (instanceKey: string, busy: boolean) =>
    store?.setBusy(instanceKey, busy)
}

/** Instance keys with demo work in flight, e.g. a chat still generating. */
export function useSessionBusyInstances(): ReadonlySet<string> {
  const store = useContext(DemoSessionContext)
  return useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store?.getBusy ?? getEmptyBusy,
    getEmptyBusy,
  )
}

/**
 * While mounted with a `notice`, the instance selector warns that switching away interrupts
 * something on this instance that cannot resume. `null` when nothing would be lost.
 */
export function useSessionLeaveNotice(
  instanceKey: string | undefined,
  notice: string | null,
) {
  const store = useContext(DemoSessionContext)
  useEffect(() => {
    if (!store || !instanceKey) return
    store.setLeaveNotice(instanceKey, notice)
    return () => store.setLeaveNotice(instanceKey, null)
  }, [store, instanceKey, notice])
}

/** What switching away from each instance would interrupt, by instance key. */
export function useSessionLeaveNotices(): ReadonlyMap<string, string> {
  const store = useContext(DemoSessionContext)
  return useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store?.getLeaveNotices ?? getEmptyNotices,
    getEmptyNotices,
  )
}

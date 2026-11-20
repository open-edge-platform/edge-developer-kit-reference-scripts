// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Orders installs into a shared Python environment against the starts of the processes that run
 * from it (see `shared-env.ts`). An install runs alone: once no process is starting and no other
 * install runs. Starts run alongside each other, but not during an install. First come, first
 * served, so a start asked for after an install waits for it. No imports, so it is testable alone.
 */

/** Ends a hold; calling it again does nothing. */
export type Release = () => void

export interface SharedEnvGate {
  /**
   * Holds the environment alone until released. `onWait` is called once if it must wait; rejects
   * with `signal`'s reason when aborted before its turn.
   */
  install(signal?: AbortSignal, onWait?: () => void): Promise<Release>
  /** Holds it alongside other starts until released or for `maxStartMs`; otherwise as `install`. */
  start(signal?: AbortSignal, onWait?: () => void): Promise<Release>
}

type HoldKind = 'install' | 'start'

interface Waiter {
  kind: HoldKind
  admit: () => void
}

export function createSharedEnvGate({
  maxStartMs,
}: {
  /** A start that never reports it is up stops holding installs back after this long. */
  maxStartMs: number
}): SharedEnvGate {
  const queue: Waiter[] = []
  let installing = false
  let starting = 0

  const canAdmit = (kind: HoldKind) =>
    !installing && (kind === 'start' || starting === 0)

  const admitWaiting = () => {
    while (queue.length > 0 && canAdmit(queue[0].kind)) {
      queue.shift()?.admit()
    }
  }

  const hold = (kind: HoldKind): Release => {
    let released = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const release = () => {
      if (released) return
      released = true
      clearTimeout(timer)
      if (kind === 'install') installing = false
      else starting--
      admitWaiting()
    }
    if (kind === 'install') {
      installing = true
    } else {
      starting++
      timer = setTimeout(release, maxStartMs)
    }
    return release
  }

  const acquire = (
    kind: HoldKind,
    signal?: AbortSignal,
    onWait?: () => void,
  ): Promise<Release> => {
    if (signal?.aborted) return Promise.reject(signal.reason)
    if (queue.length === 0 && canAdmit(kind)) {
      return Promise.resolve(hold(kind))
    }
    onWait?.()
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        kind,
        admit: () => {
          signal?.removeEventListener('abort', onAbort)
          resolve(hold(kind))
        },
      }
      const onAbort = () => {
        const index = queue.indexOf(waiter)
        if (index === -1) return
        queue.splice(index, 1)
        reject(signal?.reason)
        // It may have been what the waiters behind it were blocked on.
        admitWaiting()
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      queue.push(waiter)
    })
  }

  return {
    install: (signal, onWait) => acquire('install', signal, onWait),
    start: (signal, onWait) => acquire('start', signal, onWait),
  }
}

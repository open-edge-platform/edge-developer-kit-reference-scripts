// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export interface PollUntilOptions {
  intervalMs: number
  /** Overall deadline from the first call, in ms. Unset polls forever. */
  timeoutMs?: number
  signal?: AbortSignal
  timeoutMessage?: string
}

function abortError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

/**
 * Calls `fetch` every `intervalMs` until `isDone` accepts its result. `timeoutMs` is only checked
 * between attempts: it does not interrupt a hanging `fetch` unless `signal` is wired into it.
 */
export function pollUntil<T>(
  fetch: () => Promise<T>,
  isDone: (value: T) => boolean,
  opts: PollUntilOptions,
): Promise<T> {
  const { intervalMs, timeoutMs, signal, timeoutMessage } = opts

  return new Promise<T>((resolve, reject) => {
    const deadline =
      timeoutMs !== undefined ? Date.now() + timeoutMs : undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }

    function onAbort() {
      cleanup()
      reject(abortError())
    }

    const tick = async () => {
      if (signal?.aborted) {
        onAbort()
        return
      }
      try {
        const value = await fetch()
        if (isDone(value)) {
          cleanup()
          resolve(value)
          return
        }
      } catch (err) {
        cleanup()
        reject(err)
        return
      }
      if (deadline !== undefined && Date.now() >= deadline) {
        cleanup()
        reject(new Error(timeoutMessage ?? 'Timed out'))
        return
      }
      if (signal?.aborted) return
      timer = setTimeout(tick, intervalMs)
    }

    signal?.addEventListener('abort', onAbort)
    tick()
  })
}

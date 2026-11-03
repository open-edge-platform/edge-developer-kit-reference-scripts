// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Bounds how long a proxied worker call may go without moving a byte (upload, think time, between
 * chunks), not its total length: a stream that keeps sending runs as long as it needs.
 */
export interface StallWatchdog {
  /** Aborts when the call stalls or the client goes away. */
  readonly signal: AbortSignal
  /** True once the watchdog gave up on a silent call (not the client). */
  readonly stalled: boolean
  /** Counts as progress: restarts the clock. */
  touch(): void
  /** Stops the clock for good. */
  stop(): void
  /**
   * `stream` with every chunk counting as progress. `endsCall` stops the clock when it ends (a
   * response body); otherwise it keeps running (an upload, the answer still awaited).
   */
  watch(
    stream: ReadableStream<Uint8Array>,
    options?: { endsCall?: boolean; onEnd?: () => void },
  ): ReadableStream<Uint8Array>
}

export function createStallWatchdog({
  timeoutMs,
  stalledError,
  clientSignal,
}: {
  timeoutMs: number
  /** The abort reason when the call stalls. */
  stalledError: () => Error
  /** The incoming request's signal: a client that leaves cancels the call. */
  clientSignal?: AbortSignal
}): StallWatchdog {
  const controller = new AbortController()
  let stalled = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const stop = () => clearTimeout(timer)
  const touch = () => {
    stop()
    timer = setTimeout(() => {
      stalled = true
      controller.abort(stalledError())
    }, timeoutMs)
  }
  touch()

  const onClientAbort = () => {
    stop()
    controller.abort(clientSignal?.reason)
  }
  if (clientSignal?.aborted) onClientAbort()
  else clientSignal?.addEventListener('abort', onClientAbort, { once: true })

  return {
    signal: controller.signal,
    get stalled() {
      return stalled
    },
    touch,
    stop,
    watch(stream, { endsCall = false, onEnd } = {}) {
      return stream.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, out) {
            touch()
            out.enqueue(chunk)
          },
          flush() {
            if (endsCall) stop()
            onEnd?.()
          },
        }),
      )
    },
  }
}

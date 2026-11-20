// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Agent, Dispatcher1Wrapper } from 'undici'

/**
 * Dispatcher for worker calls bounded by their own `AbortSignal`: Node's fetch otherwise gives up
 * after 300 s without headers or between body chunks, and reports it as a network failure.
 *
 * Callers pass it to Node's built-in `fetch`, whose bundled undici (7.x on Node 24) sends legacy
 * handlers (`onConnect`/`onHeaders`/...). Undici 8 dropped those, so a bare `Agent` fails every
 * call with "invalid onRequestStart method"; the wrapper adapts them and passes new-style handlers
 * through unchanged.
 */
export const untimedDispatcher = new Dispatcher1Wrapper(
  new Agent({
    headersTimeout: 0,
    bodyTimeout: 0,
  }),
)

/** `RequestInit` plus the Node fetch options the DOM typings leave out. */
export type WorkerRequestInit = RequestInit & {
  duplex?: 'half'
  dispatcher?: typeof untimedDispatcher
}

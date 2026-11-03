// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Agent } from 'undici'

/**
 * Dispatcher for worker calls bounded by their own `AbortSignal`: Node's fetch otherwise gives up
 * after 300 s without headers or between body chunks, and reports it as a network failure.
 */
export const untimedDispatcher = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
})

/** `RequestInit` plus the Node fetch options the DOM typings leave out. */
export type WorkerRequestInit = RequestInit & {
  duplex?: 'half'
  dispatcher?: typeof untimedDispatcher
}

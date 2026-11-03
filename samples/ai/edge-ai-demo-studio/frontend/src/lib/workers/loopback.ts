// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { safeUrl, URL_CHARS } from '@/lib/validation'
import type { WorkerRequestInit } from '@/lib/workers/untimed-dispatcher'

/** Base URL for a local worker or engine: IPv4 loopback, so calls agree however `localhost` resolves. */
export function loopbackBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`
}

/** Response header carrying the answering worker's or engine's instance key (`type@instanceId`). */
const INSTANCE_HEADER = 'x-edge-ai-studio-instance'

/**
 * The instance that sent `response` when it is not `expectedKey` (e.g. one started on a port a stop
 * freed). Null when it is expected or unnamed (a docker suite, a worker started by hand).
 */
export function answeredByOtherInstance(
  response: Response,
  expectedKey: string,
): string | null {
  const answered = response.headers.get(INSTANCE_HEADER)
  return answered && answered !== expectedKey ? answered : null
}

/** `fetch` of `path` on the local `port`. Throws before sending if the URL fails `safeUrl`/`URL_CHARS`. */
export function fetchLoopback(
  port: number,
  path: string,
  init?: WorkerRequestInit,
): Promise<Response> {
  let target = ''
  for (const ch of safeUrl(`${loopbackBaseUrl(port)}${path}`)) {
    let ok = ''
    for (const allowed of URL_CHARS)
      if (allowed === ch) {
        ok = allowed
        break
      }
    if (!ok) throw new Error('Forbidden character in URL')
    target += ok
  }
  return fetch(target, init)
}

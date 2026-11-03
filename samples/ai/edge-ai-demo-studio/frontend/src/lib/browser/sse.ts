// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Reads the Server-Sent Events long worker calls answer with (`worker_common.sse`). `EventSource`
 * only does GET without a body or abort signal, so these read a `fetch` body instead.
 */

import {
  fetchOk,
  isHttpError,
  type FetchJsonInit,
} from '@/lib/browser/fetch-json'
import { safeUrl, URL_CHARS } from '@/lib/validation'

export interface SseMessage {
  /** The event name; `message` when the stream named none. */
  event: string
  data: string
  id?: string
}

async function* readSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseMessage> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event = ''
  let data: string[] = []
  let id: string | undefined
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline: number
      while ((newline = buffer.search(/\r\n|\r|\n/)) >= 0) {
        // A trailing `\r` may be the first half of a `\r\n` still on its way.
        if (buffer[newline] === '\r' && newline === buffer.length - 1) break
        const line = buffer.slice(0, newline)
        const width = buffer.startsWith('\r\n', newline) ? 2 : 1
        buffer = buffer.slice(newline + width)
        if (line === '') {
          if (data.length > 0) {
            yield { event: event || 'message', data: data.join('\n'), id }
          }
          event = ''
          data = []
          continue
        }
        if (line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon < 0 ? line : line.slice(0, colon)
        const raw = colon < 0 ? '' : line.slice(colon + 1)
        const text = raw.startsWith(' ') ? raw.slice(1) : raw
        if (field === 'event') event = text
        else if (field === 'data') data.push(text)
        else if (field === 'id') id = text
      }
    }
    // An unterminated last event is dropped, per the SSE spec: its data may be cut short.
  } finally {
    reader.cancel().catch(() => {})
  }
}

/** `readSse` with each event's data parsed as JSON. */
export async function* readSseJson<T = unknown>(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: T }> {
  for await (const message of readSse(body)) {
    yield { event: message.event, data: JSON.parse(message.data) as T }
  }
}

/** The message of an `error` event: `{ detail }`, `{ error }` or text. */
export function sseErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === 'string' && data) return data
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    for (const key of ['detail', 'error', 'message']) {
      if (typeof record[key] === 'string' && record[key]) {
        return record[key] as string
      }
    }
  }
  return fallback
}

export interface FollowStatusOptions<T> {
  signal?: AbortSignal
  /** Called with every status, the final one included. */
  onStatus?: (status: T) => void
  isFinal: (status: T) => boolean
  init?: FetchJsonInit
}

/** Times a dropped stream is reopened in a row before giving up. */
const MAX_RECONNECTS = 3

/**
 * Follows a job's status stream until a final status, which it resolves with; an `error` event
 * rejects. A dropped stream is reopened: the job keeps running on the worker either way.
 */
export async function followStatusEvents<T>(
  url: string,
  { signal, onStatus, isFinal, init }: FollowStatusOptions<T>,
): Promise<T> {
  let failures = 0
  while (true) {
    let progressed = false
    try {
      const res = await fetchOk(url, {
        ...init,
        signal,
        headers: { Accept: 'text/event-stream', ...init?.headers },
      })
      if (!res.body) throw new Error('The status stream has no body')
      for await (const { event, data } of readSseJson<T>(res.body)) {
        if (event === 'error') {
          throw new StatusStreamError(sseErrorMessage(data, 'The job failed'))
        }
        progressed = true
        onStatus?.(data)
        if (isFinal(data)) return data
      }
    } catch (error) {
      if (signal?.aborted || error instanceof StatusStreamError) throw error
      if (isHttpError(error)) throw error
      failures = progressed ? 1 : failures + 1
      if (failures > MAX_RECONNECTS) throw error
      continue
    }
    failures = progressed ? 1 : failures + 1
    if (failures > MAX_RECONNECTS) {
      throw new Error('The status stream ended before the job finished')
    }
  }
}

/** The final status of a job cancelled with `cancelJob`, on every worker. */
export const CANCELLED = 'cancelled'

/**
 * Best-effort cancel of a job (`DELETE` on its status path); never throws. A running job stops at
 * its next safe point; `keepalive` lets the request outlive a closing page.
 */
export async function cancelJob(url: string): Promise<void> {
  try {
    let target = ''
    for (const ch of safeUrl(url)) {
      let ok = ''
      for (const allowed of URL_CHARS)
        if (allowed === ch) {
          ok = allowed
          break
        }
      if (!ok) throw new Error('Forbidden character in URL')
      target += ok
    }
    await fetch(target, { method: 'DELETE', keepalive: true })
  } catch {
    // The worker is gone or unreachable: there is nothing left to cancel.
  }
}

/** An `error` event the worker sent: final, never retried. */
class StatusStreamError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StatusStreamError'
  }
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Fetch helpers that throw on a non-OK response, reading the message from FastAPI `{ detail }`,
 * Next.js `{ error }`, Payload `{ errors }` or a plain-text body.
 */

import { safeUrl, URL_CHARS } from '@/lib/validation'

/** A non-OK response. Exported as a type only: test for it with {@link isHttpError}. */
class HttpError extends Error {
  readonly status: number
  /** Parsed JSON body when the error response carried one, else the raw text. */
  readonly body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.body = body
  }
}

export type { HttpError }

export function isHttpError(err: unknown, status?: number): err is HttpError {
  return (
    err instanceof HttpError && (status === undefined || err.status === status)
  )
}

/** First usable message in an error body, including FastAPI's `{ detail: [{ msg }] }` shapes. */
function messageFromBody(body: unknown): string | undefined {
  if (typeof body === 'string') return body.trim() || undefined
  if (Array.isArray(body)) {
    const messages = body.map(messageFromBody).filter(Boolean)
    return messages.length > 0 ? messages.join('; ') : undefined
  }
  if (body && typeof body === 'object') {
    // `errors` is Payload's REST shape: `{ errors: [{ message, data? }] }`.
    for (const key of [
      'detail',
      'error',
      'message',
      'msg',
      'errors',
    ] as const) {
      const message = messageFromBody((body as Record<string, unknown>)[key])
      if (message) return message
    }
  }
  return undefined
}

/** Reads a body once, as JSON when it parses and as text otherwise. */
async function readBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '')
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export interface FetchJsonInit extends RequestInit {
  /** Message used when the response body carries none of its own. */
  errorMessage?: string
}

/** `fetch` that throws an {@link HttpError} for a non-OK response; for blob, text or stream bodies. */
export async function fetchOk(
  input: RequestInfo | URL,
  init?: FetchJsonInit,
): Promise<Response> {
  const { errorMessage, ...requestInit } = init ?? {}
  const raw = input instanceof Request ? input.url : String(input)
  let target = ''
  for (const ch of safeUrl(raw)) {
    let ok = ''
    for (const allowed of URL_CHARS)
      if (allowed === ch) {
        ok = allowed
        break
      }
    if (!ok) throw new Error('Forbidden character in URL')
    target += ok
  }
  const safeInput =
    input instanceof Request ? new Request(target, input) : target
  const res = await fetch(safeInput, requestInit)
  if (res.ok) return res

  const body = await readBody(res)
  const message =
    messageFromBody(body) ??
    errorMessage ??
    (res.statusText || `Request failed with status ${res.status}`)
  throw new HttpError(message, res.status, body)
}

/** Parsed JSON body, throwing like {@link fetchOk}; an empty body (204) resolves to `undefined`. */
export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: FetchJsonInit,
): Promise<T> {
  return (await readBody(await fetchOk(input, init))) as T
}

/** `fetchJson` for a JSON request body; defaults to POST. */
export function postJson<T>(
  input: RequestInfo | URL,
  body: unknown,
  init?: FetchJsonInit,
): Promise<T> {
  return fetchJson<T>(input, {
    method: 'POST',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    body: JSON.stringify(body),
  })
}

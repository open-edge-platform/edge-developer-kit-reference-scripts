// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export const PROXY_TIMEOUT_MESSAGE =
  // 'The request timed out. The task may be too large or the service is busy — please try again later or adjust the proxy timeout in the Settings.'
  'The request ran into an internal error or timed out. The task may be too large or the service is busy — please try again later or adjust the proxy timeout in the Settings.'

/**
 * Generic error text Next.js sends to the browser when its internal rewrite
 * proxy gives up on a worker (timeout / dropped connection). The underlying
 * "socket hang up" / ECONNRESET only surfaces in the server log — the client
 * just receives a plain-text 500 "Internal Server Error". Real workers report
 * failures as `application/json` with a `detail` field, so a non-JSON 500
 * carrying this text is unambiguously a proxy failure.
 */
const GENERIC_PROXY_ERROR_TEXT = 'internal server error'

let installed = false

/**
 * Installs a global `window.fetch` wrapper (once) that maps Next.js proxy
 * timeout responses to a friendly, actionable error instead of the raw
 * "Internal Server Error" text.
 *
 * All other responses — including real JSON error bodies returned by workers —
 * pass through unchanged, so existing `res.ok` / body-parsing logic in every
 * hook keeps working without any per-call changes.
 *
 * Safe to call multiple times; only the first call takes effect. No-op on
 * the server (there is no proxy involved in server-side fetches).
 */
export function installProxyFetchInterceptor(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  const originalFetch = window.fetch.bind(window)

  window.fetch = async (input, init) => {
    const res = await originalFetch(input, init)

    if (res.status === 500) {
      const contentType = res.headers.get('content-type')?.toLowerCase() ?? ''
      const isJson = contentType.includes('application/json')
      if (!isJson) {
        const body = await res
          .clone()
          .text()
          .catch(() => '')
        if (body.toLowerCase().includes(GENERIC_PROXY_ERROR_TEXT)) {
          throw new Error(PROXY_TIMEOUT_MESSAGE)
        }
      }
    }

    return res
  }
}

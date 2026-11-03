// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * MCP server address policy: http(s) on this machine or a private network, never an internet host,
 * so a stored server cannot turn the app into a proxy (SSRF). Isomorphic.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function isLocalOrPrivateHost(hostname: string): boolean {
  // `URL.hostname` keeps an IPv6 literal's brackets: `[::1]`.
  const host = hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase()
  return (
    LOOPBACK_HOSTS.has(host) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)
  )
}

export type McpUrlCheck = { ok: true; url: URL } | { ok: false; error: string }

/** Parses `raw` and checks it against the MCP address policy. */
export function checkMcpServerUrl(raw: unknown): McpUrlCheck {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'Missing url' }
  }
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, error: 'Invalid URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Only HTTP(S) URLs are allowed' }
  }
  if (!isLocalOrPrivateHost(url.hostname)) {
    return { ok: false, error: 'Only local/private network URLs are allowed' }
  }
  return { ok: true, url }
}

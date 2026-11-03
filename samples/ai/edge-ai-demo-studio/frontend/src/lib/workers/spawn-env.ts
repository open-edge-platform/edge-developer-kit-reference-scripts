// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Loopback hosts every child must reach directly: a shell exporting `http_proxy` without a matching
 * `no_proxy` sends workers' loopback calls through the proxy, which answers 403.
 */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'] as const

/** The union of `NO_PROXY` and `no_proxy` plus the loopback hosts (tools disagree on which wins). */
function loopbackNoProxyList(...values: (string | undefined)[]): string {
  const hosts: string[] = []
  const seen = new Set<string>()
  const add = (host: string) => {
    const key = host.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    hosts.push(host)
  }
  for (const value of values) {
    for (const entry of value?.split(',') ?? []) {
      const host = entry.trim()
      if (host) add(host)
    }
  }
  for (const host of LOOPBACK_HOSTS) add(host)
  return hosts.join(',')
}

/**
 * `env` with the loopback hosts added to both `NO_PROXY` and `no_proxy`, for spawned processes that
 * honour proxy variables (Node's `fetch` does not). Idempotent.
 */
export function withLoopbackNoProxy(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const noProxy = loopbackNoProxyList(env.NO_PROXY, env.no_proxy)
  return { ...env, NO_PROXY: noProxy, no_proxy: noProxy }
}

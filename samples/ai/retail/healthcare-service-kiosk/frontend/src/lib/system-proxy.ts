// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import http from "node:http";

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1"];

/**
 * Sends the server's outbound fetch (a remote LLM, webhooks) through the system proxy —
 * `https_proxy` / `http_proxy` in either case — which Node ignores unless told. Loopback joins
 * `no_proxy` first: without it Node would send the local AI services to the proxy too.
 */
export function applySystemProxy(): void {
  const env = process.env;
  const node = http as typeof http & { setGlobalProxyFromEnv?: () => void };
  const proxied = ["https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY"].some((key) => env[key]);
  if (!proxied || typeof node.setGlobalProxyFromEnv !== "function") return;
  const hosts = [env.NO_PROXY, env.no_proxy, LOOPBACK_HOSTS.join(",")]
    .flatMap((value) => value?.split(",") ?? [])
    .map((host) => host.trim())
    .filter(Boolean);
  env.NO_PROXY = env.no_proxy = [...new Set(hosts)].join(",");
  node.setGlobalProxyFromEnv();
}

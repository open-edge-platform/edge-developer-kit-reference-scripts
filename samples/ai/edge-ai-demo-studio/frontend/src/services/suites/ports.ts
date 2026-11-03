// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** A suite's port block starts with HTTP at `basePort`, then HTTPS. */
export function suiteHttpsPort(basePort: number): number {
  return basePort + 1
}

/** The suite's own HTTPS page on this host, or `undefined` until the instance has a port. */
export function suiteHttpsUrl(
  service: { instancePort?: number } | undefined,
  path = '/',
): string | undefined {
  const basePort = service?.instancePort
  if (!basePort) return undefined
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `https://127.0.0.1:${suiteHttpsPort(basePort)}${suffix}`
}

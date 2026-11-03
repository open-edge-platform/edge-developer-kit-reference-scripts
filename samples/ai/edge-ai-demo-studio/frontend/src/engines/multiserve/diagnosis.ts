// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { fetchLoopback } from '@/lib/workers/loopback'
import type { Service } from '@/payload-types'
import { isMultiserveHealthy, MULTISERVE_HEALTH_URL } from './health'

/**
 * Server-side probes of a running engine, for the health poller and the start path. `/v1/status`
 * lists the models the model servers hold.
 */

const STATUS_PATH = '/v1/status'
const PROBE_TIMEOUT_MS = 3_000

/** Whether the engine answers `/v1/health` with both backends OK. */
export async function isEngineHealthy(
  port: number,
  signal: AbortSignal = AbortSignal.timeout(PROBE_TIMEOUT_MS),
): Promise<boolean> {
  try {
    const res = await fetchLoopback(port, MULTISERVE_HEALTH_URL, { signal })
    if (!res.ok) return false
    return isMultiserveHealthy(await res.json())
  } catch {
    return false
  }
}

/** Two quick attempts at the engine's status endpoint, no backoff. */
export async function isReachable(port: number): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchLoopback(port, STATUS_PATH, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      await res.body?.cancel()
      if (res.ok) return true
    } catch {
      // fall through to the second attempt
    }
  }
  return false
}

export async function describeUnhealthy(
  service: Service,
  port: number,
): Promise<string> {
  const model = service.models?.default?.name ?? 'the configured model'
  try {
    const res = await fetchLoopback(port, STATUS_PATH, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!res.ok) return `Engine on port ${port} answered ${res.status}`
    const data: unknown = await res.json()
    const status =
      data && typeof data === 'object' && 'status' in data ? data.status : null
    const listed = Object.values(
      status && typeof status === 'object' ? status : {},
    )
      .flat()
      .some((entry: unknown) => {
        const repoId =
          entry && typeof entry === 'object' && 'repo_id' in entry
            ? entry.repo_id
            : undefined
        return (
          typeof repoId === 'string' &&
          (repoId === model || repoId.startsWith(`${model}:`))
        )
      })
    return listed
      ? `Engine is running but "${model}" no longer matches this instance's configuration`
      : `Engine is running but "${model}" is no longer loaded — the model server reports it unavailable`
  } catch {
    return `Engine on port ${port} is not responding`
  }
}

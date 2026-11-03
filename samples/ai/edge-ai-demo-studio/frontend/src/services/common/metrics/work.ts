// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Model work a demo sends, measured in the browser per instance address for Live metrics. Only this
 * tab's calls count (every call's count is on the Logs tab); kept for the tab's life.
 */

import { useSyncExternalStore } from 'react'
import { type FetchJsonInit, fetchOk } from '@/lib/browser/fetch-json'
import type { MeasuredWork, MetricsQuantities } from './types'

export interface InstanceWork {
  /** The latest successful work; `null` until there is some. */
  lastWork: MeasuredWork | null
  /** Calls started and not settled yet. */
  inFlight: number
  /** Calls that settled, cancelled ones left out. */
  calls: number
  /** Of `calls`, how many failed. */
  failed: number
}

const NONE: InstanceWork = { lastWork: null, inFlight: 0, calls: 0, failed: 0 }
/** Jobs remembered per instance, so a job followed again counts once. */
const MAX_JOB_KEYS = 50

const store = new Map<string, InstanceWork>()
const jobKeys = new Map<string, string[]>()
const listeners = new Set<() => void>()

function update(apiBase: string, change: (work: InstanceWork) => InstanceWork) {
  store.set(apiBase, change(store.get(apiBase) ?? NONE))
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The work measured for an instance address, kept current. */
export function useInstanceWork(apiBase: string | undefined): InstanceWork {
  return useSyncExternalStore(
    subscribe,
    () => (apiBase && store.get(apiBase)) || NONE,
    () => NONE,
  )
}

/** Forgets an instance's work and counts; calls still running count afresh. */
export function resetWork(apiBase: string) {
  if (!store.has(apiBase)) return
  const inFlight = store.get(apiBase)?.inFlight ?? 0
  update(apiBase, () => ({ ...NONE, inFlight }))
}

/** What a response or the worker said about the work, beyond the demo's own timing. */
export interface WorkMeasures {
  /** The worker's time for the work itself, ms. */
  inferenceMs?: number
  quantities?: MetricsQuantities
}

/** The positive, finite quantities, rounded. */
function quantitiesOf(quantities: MetricsQuantities = {}): MetricsQuantities {
  const kept: MetricsQuantities = {}
  for (const [name, amount] of Object.entries(quantities)) {
    if (Number.isFinite(amount) && amount > 0) {
      kept[name] = Math.round(amount * 1000) / 1000
    }
  }
  return kept
}

function keep(apiBase: string, work: MeasuredWork) {
  update(apiBase, (current) => ({
    ...current,
    lastWork: { ...work, quantities: quantitiesOf(work.quantities) },
  }))
}

export interface WorkTimer {
  /** The first output (token) of a streamed answer arrived. */
  firstOutput(): void
  /** The call succeeded. */
  finish(measures?: WorkMeasures): void
  failed(): void
  /** The call was cancelled; it counts neither way. */
  aborted(): void
  /** `aborted` when `signal` was aborted, else `failed`. */
  settleError(signal?: AbortSignal | null): void
}

/** Starts timing one call to an instance; only the first of `finish`/`failed`/`aborted` counts. */
export function startWork(apiBase: string | undefined): WorkTimer {
  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)
  let firstOutputMs: number | undefined
  let settled = false
  if (apiBase) update(apiBase, (w) => ({ ...w, inFlight: w.inFlight + 1 }))

  const settle = (outcome: 'ok' | 'failed' | 'aborted') => {
    if (settled || !apiBase) return false
    settled = true
    update(apiBase, (w) => ({
      ...w,
      inFlight: Math.max(0, w.inFlight - 1),
      calls: w.calls + (outcome === 'aborted' ? 0 : 1),
      failed: w.failed + (outcome === 'failed' ? 1 : 0),
    }))
    return true
  }

  const timer: WorkTimer = {
    firstOutput() {
      if (firstOutputMs === undefined) firstOutputMs = elapsed()
    },
    finish({ inferenceMs, quantities } = {}) {
      const responseMs = elapsed()
      if (!settle('ok') || !apiBase) return
      keep(apiBase, {
        at: Date.now(),
        responseMs,
        ...(inferenceMs !== undefined && { inferenceMs }),
        ...(firstOutputMs !== undefined && { firstOutputMs }),
        quantities: quantities ?? {},
      })
    },
    failed() {
      settle('failed')
    },
    aborted() {
      settle('aborted')
    },
    settleError(signal) {
      if (signal?.aborted) timer.aborted()
      else timer.failed()
    },
  }
  return timer
}

/** Records work the demo could not time as one call, e.g. an utterance on a live socket. */
export function recordWork(
  apiBase: string | undefined,
  work: WorkMeasures & { responseMs?: number },
) {
  if (!apiBase) return
  keep(apiBase, {
    at: Date.now(),
    ...(work.responseMs !== undefined && { responseMs: work.responseMs }),
    ...(work.inferenceMs !== undefined && { inferenceMs: work.inferenceMs }),
    quantities: work.quantities ?? {},
  })
}

/** The worker's model-call ms from a `Server-Timing: inference;dur=<ms>` header, if present. */
export function serverTimingMs(headers: Headers): number | undefined {
  for (const entry of (headers.get('server-timing') ?? '').split(',')) {
    const [name, ...params] = entry.split(';').map((part) => part.trim())
    if (name.toLowerCase() !== 'inference') continue
    for (const param of params) {
      const [key, value] = param.split('=')
      if (key.trim().toLowerCase() !== 'dur') continue
      const ms = Number(value)
      return Number.isFinite(ms) && ms >= 0
        ? Math.round(ms * 10) / 10
        : undefined
    }
  }
  return undefined
}

/** Keys of a `perf` block that are not quantities. */
const PERF_RESERVED = ['seconds', 'started']

/**
 * Records a finished job from its final status' `perf` block (docs/DEVELOPMENT.md, "Live metrics"):
 * `seconds` is processing time, other numbers are quantities. A job followed again counts once.
 */
export function recordJob(
  apiBase: string | undefined,
  jobId: string,
  perf: unknown,
) {
  if (!apiBase || perf === null || typeof perf !== 'object') return
  const { seconds } = perf as { seconds?: unknown }
  if (typeof seconds !== 'number' || !(seconds >= 0)) return
  const seen = jobKeys.get(apiBase) ?? []
  if (seen.includes(jobId)) return
  jobKeys.set(apiBase, [...seen, jobId].slice(-MAX_JOB_KEYS))

  const quantities: MetricsQuantities = {}
  for (const [name, value] of Object.entries(perf)) {
    if (typeof value === 'number' && !PERF_RESERVED.includes(name)) {
      const camel = name.replace(/_([a-z0-9])/g, (_, c: string) =>
        c.toUpperCase(),
      )
      quantities[camel] = value
    }
  }
  keep(apiBase, {
    at: Date.now(),
    inferenceMs: Math.round(seconds * 1000),
    quantities,
    reported: true,
  })
}

/** `fetchJson` for a model call, timed to its parsed body, with `Server-Timing` and `measure`. */
export async function fetchWork<T>(
  apiBase: string,
  path: string,
  init: FetchJsonInit,
  measure: (body: T) => MetricsQuantities,
): Promise<T> {
  const timer = startWork(apiBase)
  try {
    const res = await fetchOk(`${apiBase}${path}`, init)
    const body = (await res.json()) as T
    timer.finish({
      inferenceMs: serverTimingMs(res.headers),
      quantities: measure(body),
    })
    return body
  } catch (error) {
    timer.settleError(init.signal)
    throw error
  }
}

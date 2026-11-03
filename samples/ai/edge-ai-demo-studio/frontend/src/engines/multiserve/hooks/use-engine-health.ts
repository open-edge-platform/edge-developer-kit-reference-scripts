// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import {
  isMultiserveHealthy,
  MULTISERVE_HEALTH_URL,
} from '@/engines/multiserve/health'
import { fetchJson, fetchOk } from '@/lib/browser/fetch-json'
import { getDraftEngineKey } from '@/lib/instances/instances'
import { pollUntil } from '@/lib/browser/poll'
import { toastError } from '@/lib/browser/toast-error'
import { safeUrl, URL_CHARS } from '@/lib/validation'

/**
 * `true` only when both backends report OK, else `false`; never throws. With the engine down the
 * proxy answers 502/503, and an error state would replace the steady `false` the model manager
 * keys on to show the disk catalogue.
 */
async function fetchEngineHealth(serviceId: string): Promise<boolean> {
  const url = new URL(
    `/api/${serviceId}${MULTISERVE_HEALTH_URL}`,
    window.location.origin,
  )
  try {
    const res = await fetchOk(url)
    return isMultiserveHealthy(await res.json())
  } catch {
    return false
  }
}

export function useEngineHealth(serviceId: string, enabled = true) {
  return useQuery({
    queryKey: ['multiserve-engine-health', serviceId],
    queryFn: () => fetchEngineHealth(serviceId),
    enabled,
    refetchInterval: 5_000,
    staleTime: 4_000,
    retry: false,
  })
}

// Keyed per instance so one instance's start does not read as "starting"
// on every other instance's panel.
const engineStartKey = (serviceId: string) =>
  ['start-engine', serviceId] as const

/** Starts and follows an instance row's engine. */
export const rowEngineUrl = (dbId: number) => `/api/services/${dbId}/engine`

/** Starts, follows and stops a type's row-less draft engine. */
export const draftEngineUrl = (type: string) =>
  `/api/services/draft-engine/${type}`

interface EngineStartState {
  starting: boolean
  healthy: boolean
}

// The server gives up on a start after ~15 s for the port and ~2 min for the
// health check; this only guards against a server that never answers.
const ENGINE_START_TIMEOUT_MS = 5 * 60_000

/**
 * Starts the engine at `url` and resolves once it is up. The POST answers at once (202); GETs then
 * follow the start, so the mutation stays pending exactly as long as the start takes.
 */
async function startEngine(url: string): Promise<void> {
  await fetchJson(url, {
    method: 'POST',
    errorMessage: 'Failed to start engine',
  })
  const state = await pollUntil(
    () => fetchJson<EngineStartState>(url),
    (value) => !value.starting,
    {
      intervalMs: 1_500,
      timeoutMs: ENGINE_START_TIMEOUT_MS,
      timeoutMessage: 'The engine is taking too long to start',
    },
  )
  if (!state.healthy) {
    throw new Error('The engine did not start. Check the engine logs.')
  }
}

export function useStartEngine(serviceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: engineStartKey(serviceId),
    mutationFn: startEngine,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['multiserve-engine-health', serviceId],
      })
    },
    onError: toastError('Failed to start engine'),
  })
}

/** Whether a start for this instance is in flight anywhere; outlives the sheet that triggered it. */
export function useIsEngineStarting(serviceId: string) {
  return useIsMutating({ mutationKey: engineStartKey(serviceId) }) > 0
}

/** Asks the server to stop `type`'s draft engine; never throws. */
function stopDraftEngine(type: string) {
  const raw = draftEngineUrl(type)
  // A URL with a character outside the allow-list is not requested at all
  // (fail closed): this runs from a cleanup, which must not throw.
  let target = ''
  for (const ch of safeUrl(raw)) {
    let ok = ''
    for (const allowed of URL_CHARS)
      if (allowed === ch) {
        ok = allowed
        break
      }
    if (!ok) {
      target = ''
      break
    }
    target += ok
  }
  // `keepalive` lets the stop go out while the page unloads.
  if (target) {
    fetch(target, { method: 'DELETE', keepalive: true }).catch(() => {})
  }
}

/**
 * Stops `type`'s draft engine when the panel drafting with it unmounts (a no-op on the server if it
 * never started). Deferred a tick, so a Strict Mode remount stops nothing.
 */
export function useStopDraftEngineOnUnmount(type: string | undefined) {
  const queryClient = useQueryClient()
  const pendingStop = useRef<{
    type: string
    timer: ReturnType<typeof setTimeout>
  } | null>(null)

  useEffect(() => {
    if (!type) return
    // Mounted again for the same type: keep its engine.
    if (pendingStop.current?.type === type) {
      clearTimeout(pendingStop.current.timer)
      pendingStop.current = null
    }
    return () => {
      const timer = setTimeout(() => {
        stopDraftEngine(type)
        // The next draft must not start from this one's "healthy".
        queryClient.removeQueries({
          queryKey: ['multiserve-engine-health', getDraftEngineKey(type)],
        })
      }, 0)
      pendingStop.current = { type, timer }
    }
  }, [type, queryClient])
}

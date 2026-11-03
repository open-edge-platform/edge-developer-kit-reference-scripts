// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { type PayloadServiceInfo, useServicesQuery } from '@/hooks/use-services'
import { fetchJson, postJson } from '@/lib/browser/fetch-json'
import { toastError } from '@/lib/browser/toast-error'
import {
  normalizeSampleInstanceBindings,
  type SampleInstanceBindings,
} from '@/lib/settings/sample-settings'

const SAMPLE_SETTINGS_QUERY_KEY = ['sample-settings'] as const

interface SampleSettingsResponse {
  instances: unknown
}

function fetchSampleInstanceBindings(): Promise<SampleInstanceBindings> {
  return fetchJson<SampleSettingsResponse | undefined>(
    '/api/samples/settings',
    { errorMessage: 'Failed to load sample settings' },
  ).then((body) => normalizeSampleInstanceBindings(body?.instances))
}

/** `{ [sampleId]: { [type]: instanceKey } }` */
export type ResolvedSampleBindings = Record<string, Record<string, string>>

const NO_BINDINGS: SampleInstanceBindings = {}

function useSampleSettingsQuery() {
  return useQuery({
    queryKey: SAMPLE_SETTINGS_QUERY_KEY,
    queryFn: fetchSampleInstanceBindings,
  })
}

/**
 * Stored bindings (row ids) resolved to instance keys of existing rows of the right type; others are
 * dropped (automatic). An empty result may be a failed load: check `useSampleSettingsState`.
 */
export function useResolvedSampleBindings(): ResolvedSampleBindings {
  const { data } = useSampleSettingsQuery()
  const { serviceInfoMap } = useServicesQuery()

  const byRowId = new Map<number, PayloadServiceInfo>()
  for (const info of Object.values(serviceInfoMap)) byRowId.set(info.id, info)

  const resolved: ResolvedSampleBindings = {}
  for (const [sampleId, perType] of Object.entries(data ?? NO_BINDINGS)) {
    const keys: Record<string, string> = {}
    for (const [type, rowId] of Object.entries(perType)) {
      const info = byRowId.get(rowId)
      if (info && info.type === type) {
        keys[type] = info.instanceKey
      }
    }
    if (Object.keys(keys).length > 0) resolved[sampleId] = keys
  }
  return resolved
}

export interface SampleSettingsState {
  /** First load, nothing has arrived yet: no sample can be judged ready. */
  loading: boolean
  /** The load failed and nothing was ever loaded: the bindings are unknown, not automatic. */
  unavailable: boolean
  /** A refetch failed but the last bindings that loaded are still in use. */
  stale: boolean
  retry: () => void
}

/**
 * Load state of the stored bindings. A failed load must never show as Automatic: the sample may be
 * pinned to another instance.
 */
export function useSampleSettingsState(): SampleSettingsState {
  const { isLoading, isError, data, refetch } = useSampleSettingsQuery()
  return {
    loading: isLoading,
    unavailable: isError && data === undefined,
    stale: isError && data !== undefined,
    retry: () => {
      refetch()
    },
  }
}

export interface BindSampleInstanceInput {
  sampleId: string
  type: string
  /** Services row id of the instance to use; `null` for automatic. */
  instance: number | null
}

/** `PATCH /api/samples/settings`; the answer replaces the cached settings. */
export async function bindSampleInstance(
  queryClient: QueryClient,
  input: BindSampleInstanceInput,
): Promise<void> {
  const body = await postJson<SampleSettingsResponse | undefined>(
    '/api/samples/settings',
    input,
    { method: 'PATCH', errorMessage: 'Failed to change the instance' },
  )
  queryClient.setQueryData(
    SAMPLE_SETTINGS_QUERY_KEY,
    normalizeSampleInstanceBindings(body?.instances),
  )
}

/** Binds a sample to an instance (or back to automatic) and reports a failure. */
export function useBindSampleInstance() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: BindSampleInstanceInput) =>
      bindSampleInstance(queryClient, input),
    onError: toastError('Failed to change the instance'),
  })
}

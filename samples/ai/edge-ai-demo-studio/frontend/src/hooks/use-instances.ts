// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { fetchJson, postJson } from '@/lib/browser/fetch-json'
import { toastError } from '@/lib/browser/toast-error'
import { pollUntil } from '@/lib/browser/poll'
import { isTransientStatus } from '@/lib/instances/service-status'
import {
  fetchServices,
  patchServiceAction,
  SERVICES_QUERY_KEY,
} from '@/hooks/use-services'
import type { ServiceConfigUpdate } from '@/hooks/use-service-config'
import type { Service as PayloadService } from '@/payload-types'

export interface CreateInstanceInput {
  type: string
  label: string
  instanceId?: string
  copyFrom?: number
  /** Engine when it differs from the source's; seeds its default model + health check before `config`. */
  engine?: string
  /** Settings from the Configure form, applied on top of the copied ones. */
  config?: ServiceConfigUpdate
  /** Merged over the seeded (or copied) model; on another backend it must name both `name` and `device`. */
  model?: Pick<ServiceConfigUpdate, 'name' | 'device' | 'backend' | 'quant'>
  autostart?: boolean
}

/** `POST /api/services`: adds an instance (the first one adds the service). */
export function createInstance(
  input: CreateInstanceInput,
  errorMessage = 'Failed to create instance',
): Promise<PayloadService> {
  return postJson('/api/services', input, { errorMessage })
}

/** Creates an instance; the caller announces it (it knows whether this added the service). */
export function useCreateInstance() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateInstanceInput) => createInstance(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY })
    },
    onError: toastError('Failed to create instance'),
  })
}

function deleteInstance(dbId: number): Promise<void> {
  return fetchJson(`/api/services/${dbId}`, {
    method: 'DELETE',
    errorMessage: 'Failed to delete instance',
  })
}

/** Deletes an instance (the last one removes the service); callers announce and report errors. */
export function useDeleteInstance() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteInstance,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY })
    },
  })
}

/** How often a start waits for its row to settle, in ms. */
const SETTLE_POLL_MS = 2000

/**
 * Polls (through the shared services query) until the row leaves `prepare`/`restart`. Returns
 * `'prepare'` on timeout instead of throwing, so one stuck instance does not abort the rest.
 */
async function waitUntilSettled(
  queryClient: QueryClient,
  dbId: number,
  timeoutMs = 5 * 60_000,
): Promise<PayloadService['status']> {
  try {
    const docs = await pollUntil(
      () =>
        queryClient
          .fetchQuery({
            queryKey: SERVICES_QUERY_KEY,
            queryFn: fetchServices,
            staleTime: SETTLE_POLL_MS / 2,
          })
          .catch((): PayloadService[] => []),
      (docs) => {
        const row = docs.find((d) => d.id === dbId)
        return row !== undefined && !isTransientStatus(row.status)
      },
      { intervalMs: SETTLE_POLL_MS, timeoutMs },
    )
    return docs.find((d) => d.id === dbId)?.status ?? 'inactive'
  } catch {
    // Only pollUntil's timeout can land here: the attempt above never throws.
    return 'prepare'
  }
}

/** How a start of several instances went, by database id. */
export interface StartInstancesOutcome {
  started: number[]
  /** Still starting when the wait gave up. */
  starting: number[]
  failed: number[]
}

/**
 * Starts instances one at a time, waiting for each to settle: two of one type starting together can
 * interfere with each other's engine start-up. Resolves with per-instance outcomes.
 */
export function useStartInstances() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (dbIds: number[]): Promise<StartInstancesOutcome> => {
      const outcome: StartInstancesOutcome = {
        started: [],
        starting: [],
        failed: [],
      }
      for (const id of dbIds) {
        try {
          await patchServiceAction(id, 'start')
        } catch {
          outcome.failed.push(id)
          continue
        }
        queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY })
        const status = await waitUntilSettled(queryClient, id)
        if (status === 'error') outcome.failed.push(id)
        else if (isTransientStatus(status)) {
          outcome.starting.push(id)
        } else outcome.started.push(id)
      }
      return outcome
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY })
    },
  })
}

/** Changes only the instance's name; its id, address and data stay. */
function renameInstance({
  dbId,
  label,
}: {
  dbId: number
  label: string
}): Promise<PayloadService> {
  return postJson(
    `/api/services/${dbId}`,
    { label },
    { method: 'PATCH', errorMessage: 'Failed to rename instance' },
  )
}

export function useRenameInstance() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: renameInstance,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY })
    },
    onError: toastError('Failed to rename instance'),
  })
}

/**
 * Whether a `deployment.json` sets up the services at each app start, so UI changes last only until
 * the next start unless it is saved again. `undefined` while unknown.
 */
export function useDeploymentFileInUse(enabled: boolean): boolean | undefined {
  const { data } = useQuery({
    queryKey: ['deployment-file-in-use'],
    enabled,
    retry: false,
    queryFn: () =>
      fetchJson<{ exists: boolean }>('/api/settings/deployment', {
        errorMessage: 'The deployment file could not be checked.',
      }),
  })
  return data?.exists
}

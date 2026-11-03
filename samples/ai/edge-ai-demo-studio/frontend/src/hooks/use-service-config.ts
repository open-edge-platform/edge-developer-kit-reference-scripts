// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { useServiceStatus } from '@/context/service-status-context'
import { postJson } from '@/lib/browser/fetch-json'
import { toastError } from '@/lib/browser/toast-error'
import { getErrorMessage } from '@/lib/errors'
import { getInstanceKey, getInstanceLabel } from '@/lib/instances/instances'
import { isRunningPayloadStatus } from '@/lib/instances/service-status'
import { SERVICES_QUERY_KEY } from '@/hooks/use-services'
import { useConfigureDraftHost } from '@/hooks/use-configure-draft'
import type { Service as PayloadService } from '@/payload-types'

export interface ServiceConfigUpdate {
  name?: string
  device?: string
  backend?: string
  source?: string
  type?: string
  quant?: string
  params?: string
  metadata?: Record<string, unknown>
}

interface UpdateServiceConfigVariables {
  /** `undefined` for a New instance draft, which has no row yet. */
  serviceId: number | undefined
  serviceType: string
  config: ServiceConfigUpdate
  /** "Save and restart"; otherwise a running instance keeps its settings until it restarts. */
  restart?: boolean
}

export async function updateServiceConfig({
  serviceId,
  config,
}: UpdateServiceConfigVariables): Promise<void> {
  if (serviceId === undefined) {
    throw new Error('This service has no instance to configure yet')
  }
  await postJson(
    `/api/services/${serviceId}`,
    { config },
    { method: 'PATCH', errorMessage: 'Failed to update service config' },
  )
}

export type ConfigSavePhase = 'saving' | 'restarting'

type SaveOutcome =
  | { restart: 'none' }
  | { restart: 'done' }
  | { restart: 'failed'; error: unknown }

/**
 * Saves a Configure panel's settings to its row and, for "Save and restart", restarts the instance.
 * Under a configure draft host, the config goes to the host instead.
 */
export function useUpdateServiceConfig() {
  const queryClient = useQueryClient()
  const draftHost = useConfigureDraftHost()
  const { restartService } = useServiceStatus()
  const [phase, setPhase] = useState<ConfigSavePhase | null>(null)

  const rowOf = (serviceId: number | undefined) =>
    queryClient
      .getQueryData<PayloadService[]>(SERVICES_QUERY_KEY)
      ?.find((doc) => doc.id === serviceId)

  const { mutate, isPending } = useMutation({
    mutationFn: async (
      variables: UpdateServiceConfigVariables,
    ): Promise<SaveOutcome> => {
      setPhase('saving')
      await updateServiceConfig(variables)
      const row = rowOf(variables.serviceId)
      if (!variables.restart || !row) return { restart: 'none' }
      setPhase('restarting')
      try {
        await restartService(getInstanceKey(row), { silent: true })
        return { restart: 'done' }
      } catch (error) {
        return { restart: 'failed', error }
      }
    },
    onSuccess: (outcome, { serviceId }) => {
      const row = rowOf(serviceId)
      const subject = row ? getInstanceLabel(row) : 'The instance'
      const object = row ? getInstanceLabel(row) : 'the instance'
      if (outcome.restart === 'done') {
        toast.success('Settings saved', {
          description: `${subject} is restarting with them.`,
        })
      } else if (outcome.restart === 'failed') {
        toast.error('Settings saved, but the restart failed', {
          description: `${getErrorMessage(outcome.error)} Restart ${object} to apply them.`,
        })
      } else if (row && isRunningPayloadStatus(row.status)) {
        toast.success('Settings saved for later', {
          description: `${subject} keeps running its current settings until it restarts.`,
        })
      } else {
        toast.success('Settings saved', {
          description: `They apply the next time ${object} starts.`,
        })
      }
      queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY })
    },
    onError: toastError('Settings not saved'),
    onSettled: () => setPhase(null),
  })

  // A draft has no row yet: its config goes to the New instance sheet.
  if (draftHost) {
    return {
      mutate: (variables: UpdateServiceConfigVariables) =>
        draftHost.capture(variables.config),
      isPending: false,
      phase: null,
    }
  }
  return { mutate, isPending, phase }
}

interface UpdateServiceEngineVariables {
  serviceId: number
  serviceType: string
  /** `worker` or an engine id. */
  engine: string
  engineLabel?: string
}

/** The server resets the model to the engine's default and restarts the service unless it is stopped. */
async function updateServiceEngine({
  serviceId,
  engine,
}: UpdateServiceEngineVariables): Promise<void> {
  await postJson(
    `/api/services/${serviceId}`,
    { engine },
    { method: 'PATCH', errorMessage: 'Failed to switch service engine' },
  )
}

/** Switches the engine of an instance, or of the draft under a draft host; callers show failures. */
export function useUpdateServiceEngine() {
  const queryClient = useQueryClient()
  const draftHost = useConfigureDraftHost()

  const { mutateAsync, isPending } = useMutation({
    mutationFn: updateServiceEngine,
    onSuccess: (_, { serviceId, engine, engineLabel }) => {
      // The row as it was when the switch was sent tells whether it restarts.
      const row = queryClient
        .getQueryData<PayloadService[]>(SERVICES_QUERY_KEY)
        ?.find((doc) => doc.id === serviceId)
      const name = row ? getInstanceLabel(row) : 'The instance'
      toast.success(`Switched to ${engineLabel ?? engine}`, {
        description:
          row && row.status !== 'inactive'
            ? `${name} is restarting on it.`
            : `${name} runs on it the next time it starts.`,
      })
      queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY })
    },
  })

  // A draft has no row to switch yet.
  if (draftHost) {
    return {
      mutateAsync: async (variables: UpdateServiceEngineVariables) =>
        draftHost.setEngine(variables.engine),
      isPending: false,
    }
  }
  return { mutateAsync, isPending }
}

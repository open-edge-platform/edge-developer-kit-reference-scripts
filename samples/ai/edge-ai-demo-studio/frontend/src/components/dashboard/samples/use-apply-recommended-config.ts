// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useServiceStatus } from '@/context/service-status-context'
import { updateServiceConfig } from '@/hooks/use-service-config'
import { getServiceById } from '@/services/registry'
import type { ResolvedRecommendation } from '@/samples/types'

const SERVICES_QUERY_KEY = ['services'] as const

/**
 * Applies a set of resolved recommended configs to the backend via PATCH.
 * Services that are already running will be automatically restarted by the API.
 * Services that are stopped remain stopped with the new config persisted.
 */
export function useApplyRecommendedConfig() {
  const { serviceInfoMap } = useServiceStatus()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (configs: ResolvedRecommendation[]) => {
      const updates = configs.flatMap((cfg) => {
        const info = serviceInfoMap[cfg.serviceId]
        if (!info) {
          throw new Error(
            `Service "${cfg.serviceId}" has no database record. Restart the app to auto-create it.`,
          )
        }

        // Device: use the resolved recommendation, fall back to current DB device
        const device = cfg.device ?? info.currentDevice
        if (!device) return []

        // Model: recommendation → current DB value → static default
        const staticService = getServiceById(cfg.serviceId)
        const modelName =
          cfg.model ??
          info.currentModel ??
          staticService?.defaultModel?.name ??
          ''
        if (!modelName) return []

        const desiredBackend = cfg.backend ?? info.currentBackend
        const desiredQuant = cfg.quant ?? info.currentQuant

        // If the desired config is identical to the current config, skip the update.
        const isNoop =
          modelName === info.currentModel &&
          device === info.currentDevice &&
          desiredBackend === info.currentBackend &&
          desiredQuant === info.currentQuant
        if (isNoop) return []

        return [
          updateServiceConfig({
            serviceId: info.id,
            serviceType: cfg.serviceId,
            config: {
              name: modelName,
              device,
              ...(desiredBackend ? { backend: desiredBackend } : {}),
              ...(desiredQuant ? { quant: desiredQuant } : {}),
            },
          }),
        ]
      })

      await Promise.all(updates)
    },
    onSuccess: () => {
      toast.success('Recommended configuration applied')
      queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY })
    },
    onError: (err) => {
      toast.error('Failed to apply configuration', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    },
  })
}

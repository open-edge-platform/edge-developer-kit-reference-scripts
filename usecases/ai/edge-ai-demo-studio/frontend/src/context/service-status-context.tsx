// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
} from 'react'
import { toast } from 'sonner'
import {
  type PayloadServiceInfo,
  useServiceAction,
  useServicesQuery,
} from '@/hooks/use-services'
import {
  type ServiceConfigUpdate,
  updateServiceConfig,
} from '@/hooks/use-service-config'
import { engines } from '@/engines/_generated/meta'
import { services as staticServices } from '@/services/registry'
import type { Service, ServiceStatus } from '@/services/types'
import { hasExecutionMode } from '@/services/types'

interface ServiceStatusContextValue {
  statusMap: Record<string, ServiceStatus>
  serviceInfoMap: Record<string, PayloadServiceInfo>
  services: Service[]
  serviceById: Map<string, Service>
  loading: boolean
  startService: (serviceType: string) => Promise<void>
  configureAndStartService: (
    serviceType: string,
    device: string,
  ) => Promise<void>
  stopService: (serviceType: string) => Promise<void>
  restartService: (serviceType: string) => Promise<void>
  isActionPending: (serviceType: string) => boolean
}

const ServiceStatusContext = createContext<ServiceStatusContextValue | null>(
  null,
)

export function ServiceStatusProvider({ children }: { children: ReactNode }) {
  const { statusMap, serviceInfoMap, isLoading } = useServicesQuery()
  const { mutate, isActionPending } = useServiceAction()
  const enrichedServices = useMemo(
    () =>
      staticServices.map((s) => {
        const info = serviceInfoMap[s.id]
        // Services with execution mode 'none' are always considered online.
        const isNone = hasExecutionMode(s.execution, 'none')
        const engineLogs =
          info?.engine && engines[info.engine]
            ? engines[info.engine].getLogs(s.id, info.currentBackend)
            : []
        return {
          ...s,
          status: isNone ? ('online' as const) : (statusMap[s.id] ?? s.status),
          ...(info && {
            dbId: info.id,
            engine: info.engine,
            currentModel: info.currentModel,
            currentDevice: info.currentDevice,
            currentBackend: info.currentBackend,
            currentModelType: info.currentModelType,
            currentQuant: info.currentQuant,
            currentSource: info.currentSource,
            metadata: info.metadata,
            logSources: [...s.logSources, ...engineLogs],
          }),
        }
      }),
    [statusMap, serviceInfoMap],
  )

  // Derive statusMap from enrichedServices so that overrides (e.g. mode:'none')
  // are reflected everywhere statusMap is consumed.
  const enrichedStatusMap = useMemo(() => {
    const map: Record<string, ServiceStatus> = {}
    for (const s of enrichedServices) {
      map[s.id] = s.status
    }
    return map
  }, [enrichedServices])

  // Pre-built lookup map for O(1) service lookups by ID
  const serviceById = useMemo(
    () => new Map<string, Service>(enrichedServices.map((s) => [s.id, s])),
    [enrichedServices],
  )

  const performAction = useCallback(
    (serviceType: string, action: 'start' | 'stop' | 'restart') => {
      const info = serviceInfoMap[serviceType]
      if (!info) {
        return Promise.reject(
          new Error(
            `Service "${serviceType}" has no database record. Restart the app to auto-create it.`,
          ),
        )
      }

      return new Promise<void>((resolve, reject) => {
        mutate(
          { serviceId: info.id, serviceType, action },
          {
            onSuccess: () => resolve(),
            onError: (err) => {
              toast.error(`Failed to ${action} service`, {
                description:
                  err instanceof Error
                    ? err.message
                    : 'An unexpected error occurred.',
              })
              reject(err)
            },
          },
        )
      })
    },
    [serviceInfoMap, mutate],
  )

  const startService = useCallback(
    (serviceType: string) => performAction(serviceType, 'start'),
    [performAction],
  )

  const configureAndStartService = useCallback(
    async (serviceType: string, device: string) => {
      const info = serviceInfoMap[serviceType]
      if (!info) {
        throw new Error(
          `Service "${serviceType}" has no database record. Restart the app to auto-create it.`,
        )
      }

      // Validate device string: must be a known base (CPU, GPU, NPU, xpu, cpu)
      // with an optional index suffix (.N or :N)
      if (!/^(cpu|gpu|npu|xpu|auto)(([.:])\d+)?$/i.test(device)) {
        throw new Error(
          `Invalid device "${device}". Expected a device like CPU, GPU, GPU.1, xpu, xpu:0, NPU, etc.`,
        )
      }

      // Resolve model name: prefer current DB value, fall back to static default
      const staticService = staticServices.find((s) => s.id === serviceType)
      const modelName =
        info.currentModel ?? staticService?.defaultModel?.name ?? ''
      if (!modelName) {
        // No model to configure — just start as-is
        return performAction(serviceType, 'start')
      }

      // Apply device config, then start
      const configBody: ServiceConfigUpdate = {
        name: modelName,
        device,
      }
      if (info.currentBackend) configBody.backend = info.currentBackend
      if (info.currentQuant) configBody.quant = info.currentQuant

      await updateServiceConfig({
        serviceId: info.id,
        serviceType,
        config: configBody,
      })

      return performAction(serviceType, 'start')
    },
    [serviceInfoMap, performAction],
  )

  const stopService = useCallback(
    (serviceType: string) => performAction(serviceType, 'stop'),
    [performAction],
  )

  const restartService = useCallback(
    (serviceType: string) => performAction(serviceType, 'restart'),
    [performAction],
  )

  return (
    <ServiceStatusContext.Provider
      value={{
        statusMap: enrichedStatusMap,
        serviceInfoMap,
        services: enrichedServices,
        serviceById,
        loading: isLoading,
        startService,
        configureAndStartService,
        stopService,
        restartService,
        isActionPending,
      }}
    >
      {children}
    </ServiceStatusContext.Provider>
  )
}

export function useServiceStatus() {
  const ctx = useContext(ServiceStatusContext)
  if (!ctx) {
    throw new Error(
      'useServiceStatus must be used within ServiceStatusProvider',
    )
  }
  return ctx
}

/**
 * Look up a single service by its ID.
 */
export function useGetService(serviceId: string): Service | undefined {
  const { serviceById } = useServiceStatus()
  return serviceById.get(serviceId)
}

/**
 * Look up multiple services by their IDs.
 * Returns a record keyed by service ID so callers can destructure:
 *
 * ```ts
 * const { embeddings, vectordb } = useGetServices(['embeddings', 'vectordb'])
 * ```
 */
export function useGetServices<T extends string>(
  serviceIds: T[],
): Record<T, Service | undefined> {
  const { serviceById } = useServiceStatus()
  return Object.fromEntries(
    serviceIds.map((id) => [id, serviceById.get(id)]),
  ) as Record<T, Service | undefined>
}

/**
 * Get the live status for a specific service type.
 * Falls back to the static status from the registry if no PayloadCMS service exists.
 */
export function useServiceLiveStatus(
  serviceType: string,
  fallbackStatus: ServiceStatus = 'offline',
): ServiceStatus {
  const { statusMap } = useServiceStatus()
  return statusMap[serviceType] ?? fallbackStatus
}

export type { PayloadServiceInfo } from '@/hooks/use-services'

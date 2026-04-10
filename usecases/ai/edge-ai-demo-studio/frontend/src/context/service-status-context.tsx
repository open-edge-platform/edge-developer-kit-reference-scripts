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
import { engines } from '@/engines/_generated/meta'
import { services as staticServices } from '@/services/registry'
import type { Service, ServiceStatus } from '@/services/types'
import { hasExecutionMode } from '@/services/types'

interface ServiceStatusContextValue {
  /** Map of service type → current status */
  statusMap: Record<string, ServiceStatus>
  /** Map of service type → PayloadCMS service info */
  serviceInfoMap: Record<string, PayloadServiceInfo>
  /** Services enriched with live DB status */
  services: Service[]
  /** Whether initial load is in progress */
  loading: boolean
  /** Start a service by its type (e.g. "text-generation") */
  startService: (serviceType: string) => Promise<void>
  /** Stop a service by its type */
  stopService: (serviceType: string) => Promise<void>
  /** Restart a service by its type */
  restartService: (serviceType: string) => Promise<void>
  /** Whether an action is currently in flight for a service type */
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
        loading: isLoading,
        startService,
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
  const { services } = useServiceStatus()
  return services.find((s) => s.id === serviceId)
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
  const { services } = useServiceStatus()
  const map = new Map<string, Service>(services.map((s) => [s.id, s]))
  return Object.fromEntries(
    serviceIds.map((id) => [id, map.get(id)]),
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

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
  serviceInfoMap: Record<string, PayloadServiceInfo>
  services: Service[]
  serviceById: Map<string, Service>
  loading: boolean
  startService: (serviceType: string) => Promise<void>
  stopService: (serviceType: string) => Promise<void>
  restartService: (serviceType: string) => Promise<void>
  isActionPending: (serviceType: string) => boolean
}

const ServiceStatusContext = createContext<ServiceStatusContextValue | null>(
  null,
)

export function ServiceStatusProvider({ children }: { children: ReactNode }) {
  const { serviceInfoMap, isLoading } = useServicesQuery()
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
          status: isNone ? ('online' as const) : (info?.status ?? s.status),
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
    [serviceInfoMap],
  )

  // Pre-built lookup map for O(1) service lookups by ID. Status lives on each
  // enriched Service (the single source of truth) — read it via serviceById,
  // useGetService(s), or useServiceLiveStatus rather than a parallel status map.
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
        serviceInfoMap,
        services: enrichedServices,
        serviceById,
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
 * Get the live status for a specific service type. Reads the enriched service's
 * status (the single source of truth) and falls back to `fallbackStatus` when no
 * such service exists.
 */
export function useServiceLiveStatus(
  serviceType: string,
  fallbackStatus: ServiceStatus = 'offline',
): ServiceStatus {
  const { serviceById } = useServiceStatus()
  return serviceById.get(serviceType)?.status ?? fallbackStatus
}

export type { PayloadServiceInfo } from '@/hooks/use-services'

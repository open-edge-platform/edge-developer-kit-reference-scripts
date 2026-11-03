// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'
import {
  type PayloadServiceInfo,
  type ServiceAction,
  useServiceAction,
  useServicesQuery,
  resolveServiceInfo,
} from '@/hooks/use-services'
import { engines } from '@/engines/_generated/meta'
import {
  useBoundInstanceKey,
  useSampleInstances,
} from '@/context/sample-instances-context'
import { pickPrimaryInstance } from '@/lib/instances/instances'
import { aggregateInstanceStatus } from '@/lib/instances/service-presentation'
import { services as staticServices } from '@/services/registry'
import type { Service, ServiceInstance, ServiceStatus } from '@/services/types'
import { instancePreference } from '@/services/types'
import { hasExecutionMode } from '@/services/execution'
import { toastError } from '@/lib/browser/toast-error'

export interface ServiceActionOptions {
  /** Skip the failure toast (the promise still rejects), e.g. for bulk actions that report once. */
  silent?: boolean
}

type RunServiceAction = (
  serviceKey: string,
  options?: ServiceActionOptions,
) => Promise<void>

/** Changes only when the list does: a background poll that brings nothing new re-renders no one. */
interface ServiceStatusContextValue {
  /** Every `services` row, keyed by instance key (`type` or `type@id`). */
  serviceInfoMap: Record<string, PayloadServiceInfo>
  /** One entry per service type (the primary instance's view + `instances`). */
  services: Service[]
  /** Lookup by service type OR instance key. */
  serviceById: Map<string, Service>
  loading: boolean
  connectionError: boolean
  /** A refresh failed but an earlier list is still shown: treat it as possibly out of date. */
  stale: boolean
  /** Fetches the list now; `useServiceActivity().refreshing` reports it. */
  refreshServices: () => void
  /** Each rejects when the request fails, after a toast unless `silent`. */
  startService: RunServiceAction
  stopService: RunServiceAction
  restartService: RunServiceAction
}

/** Requests in flight, kept apart from the list so only the spinners re-render when it changes. */
interface ServiceActivityContextValue {
  /** A refresh asked for through `refreshServices` is running (background polls never count). */
  refreshing: boolean
  isActionPending: (serviceKey: string) => boolean
  getPendingAction: (serviceKey: string) => ServiceAction | null
}

const ServiceStatusContext = createContext<ServiceStatusContextValue | null>(
  null,
)

const ServiceActivityContext =
  createContext<ServiceActivityContextValue | null>(null)

/** Builds the view of one instance row on top of the static service meta. */
function buildInstanceView(
  s: Service,
  info: PayloadServiceInfo,
  isNone: boolean,
): ServiceInstance {
  const engineLogs =
    info.engine && engines[info.engine]
      ? engines[info.engine].getLogs(s.id, info.currentBackend)
      : []
  // An instance's process log is `logs/<instanceKey>.log`.
  const serviceLogs = s.logSources.map((src) =>
    src.type === 'service' && src.target === s.id
      ? { ...src, label: info.instanceKey, target: info.instanceKey }
      : src,
  )
  return {
    ...s,
    status: isNone ? ('online' as const) : info.status,
    statusMessage: info.statusMessage,
    startingSince: info.startingSince,
    dbId: info.id,
    engine: info.engine,
    healthCheck: info.healthCheck ?? s.healthCheck,
    currentModel: s.runtimeLabel?.(info) ?? info.currentModel,
    currentDevice: info.currentDevice,
    currentBackend: info.currentBackend,
    currentModelType: info.currentModelType,
    currentQuant: info.currentQuant,
    currentSource: info.currentSource,
    metadata: info.metadata,
    applied: info.applied,
    startup: info.startup,
    logSources: [...serviceLogs, ...engineLogs],
    instanceId: info.instanceId,
    label: info.label,
    instanceKey: info.instanceKey,
    apiBase: info.apiBase,
    instancePort: info.port,
  }
}

/** One entry per service type: the static meta enriched with its rows. */
function buildServices(
  serviceInfoMap: Record<string, PayloadServiceInfo>,
): Service[] {
  return staticServices.map((s) => {
    // Services with execution mode 'none' are always considered online.
    const isNone = hasExecutionMode(s.execution, 'none')
    // In creation order — the order the page and the sidebar list them.
    const rows = Object.values(serviceInfoMap)
      .filter((info) => info.type === s.id)
      .sort((a, b) => a.id - b.id)
    const views = rows.map((info) => buildInstanceView(s, info, isNone))
    // The primary instance backs the type-level view: the running one, else the first.
    const primary = pickPrimaryInstance(views, (i) =>
      instancePreference(i.status),
    )

    if (!primary) {
      // No row: nobody added it. A `none` service never has one: online for samples, but
      // overview surfaces list it with the services nobody added, not as running.
      if (isNone) {
        return {
          ...s,
          status: 'online' as const,
          instances: [],
          aggregateStatus: 'offline' as const,
        } satisfies Service
      }
      return { ...s, instances: [] } satisfies Service
    }

    // The type-level view IS the primary instance (so lookups by type reach a running address),
    // plus all instances and their aggregate status for overview surfaces.
    return {
      ...primary,
      instances: views,
      added: true,
      aggregateStatus: aggregateInstanceStatus(views.map((i) => i.status)),
    } satisfies Service
  })
}

/** Lookups by service type AND by instance key; status lives on each Service, not a parallel map. */
function indexServices(services: Service[]): Map<string, Service> {
  const map = new Map<string, Service>()
  for (const s of services) {
    map.set(s.id, s)
    for (const inst of s.instances ?? []) {
      map.set(inst.instanceKey, inst)
    }
  }
  return map
}

export function ServiceStatusProvider({ children }: { children: ReactNode }) {
  const { serviceInfoMap, hasData, isLoading, isError, refetch } =
    useServicesQuery()
  const { run, isActionPending, getPendingAction } = useServiceAction()
  // Refreshes in flight: overlapping ones keep the spinner until the last ends.
  const [refreshes, setRefreshes] = useState(0)

  // Rebuilt only when the rows change; the compiler memoizes both.
  const services = buildServices(serviceInfoMap)
  const serviceById = indexServices(services)

  const refreshServices = () => {
    setRefreshes((n) => n + 1)
    refetch().finally(() => setRefreshes((n) => n - 1))
  }

  const performAction = (
    serviceKey: string,
    action: ServiceAction,
    { silent = false }: ServiceActionOptions = {},
  ): Promise<void> => {
    const info = resolveServiceInfo(serviceInfoMap, serviceKey)
    // A type nobody added has no row; starting it adds it (see
    // performServiceAction). An instance key that matches nothing is gone.
    const addable =
      !info &&
      action === 'start' &&
      staticServices.some(
        (s) => s.id === serviceKey && !hasExecutionMode(s.execution, 'none'),
      )
    if (!info && !addable) {
      return Promise.reject(
        new Error(`Service "${serviceKey}" has no instance to ${action}.`),
      )
    }

    const request = run({
      serviceId: info?.id,
      serviceType: info?.type ?? serviceKey,
      serviceKey,
      action,
    })
    if (silent) return request
    return request.catch((err: unknown) => {
      toastError(`Failed to ${action} service`)(err)
      throw err
    })
  }

  const status: ServiceStatusContextValue = {
    serviceInfoMap,
    services,
    serviceById,
    loading: isLoading,
    connectionError: isError,
    stale: isError && hasData,
    refreshServices,
    startService: (key, options) => performAction(key, 'start', options),
    stopService: (key, options) => performAction(key, 'stop', options),
    restartService: (key, options) => performAction(key, 'restart', options),
  }
  const activity: ServiceActivityContextValue = {
    refreshing: refreshes > 0,
    isActionPending,
    getPendingAction,
  }

  return (
    <ServiceStatusContext.Provider value={status}>
      <ServiceActivityContext.Provider value={activity}>
        {children}
      </ServiceActivityContext.Provider>
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

/** Requests in flight, for spinners; apart from `useServiceStatus` so others don't re-render. */
export function useServiceActivity() {
  const ctx = useContext(ServiceActivityContext)
  if (!ctx) {
    throw new Error(
      'useServiceActivity must be used within ServiceStatusProvider',
    )
  }
  return ctx
}

/**
 * A service by type (the primary instance's view) or one instance by key (`type@instanceId`).
 * On a sample page, a type the sample binds answers with the bound instance.
 */
export function useGetService(serviceId: string): Service | undefined {
  const { serviceById } = useServiceStatus()
  const bound = useBoundInstanceKey(serviceId)
  return serviceById.get(bound ?? serviceId)
}

/**
 * Where a service answers (`/api/<type>@<instanceId>`), resolved like `useGetService`. `undefined`
 * while loading or with no instance yet: there is no bare `/api/<type>` to fall back to.
 */
export function useServiceApiBase(serviceIdOrKey: string): string | undefined {
  const { serviceById } = useServiceStatus()
  const bound = useBoundInstanceKey(serviceIdOrKey)
  return serviceById.get(bound ?? serviceIdOrKey)?.apiBase
}

/** Every added instance of a service type, in creation order. */
export function useServiceInstances(serviceType: string): ServiceInstance[] {
  const { serviceById } = useServiceStatus()
  return serviceById.get(serviceType)?.instances ?? []
}

/** Several services by id, as a record callers can destructure. */
export function useGetServices<T extends string>(
  serviceIds: T[],
): Record<T, Service | undefined> {
  const { serviceById } = useServiceStatus()
  // Types the sample being shown binds resolve to their bound instance.
  const bindings = useSampleInstances()?.bindings
  return Object.fromEntries(
    serviceIds.map((id) => [id, serviceById.get(bindings?.[id] ?? id)]),
  ) as Record<T, Service | undefined>
}

/** Live status of a service type, or of its bound instance on a sample page. */
export function useServiceLiveStatus(
  serviceType: string,
  fallbackStatus: ServiceStatus = 'offline',
): ServiceStatus {
  const { serviceById } = useServiceStatus()
  const bound = useBoundInstanceKey(serviceType)
  return serviceById.get(bound ?? serviceType)?.status ?? fallbackStatus
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import type { Service as PayloadService } from '@/payload-types'
import type { ServiceStatus } from '@/services/types'

const SERVICES_QUERY_KEY = ['services'] as const
const POLL_INTERVAL = 5000

function mapPayloadStatus(
  status: PayloadService['status'] | null | undefined,
): ServiceStatus {
  switch (status) {
    case 'active':
      return 'online'
    case 'prepare':
    case 'restart':
      return 'starting'
    case 'error':
      return 'error'
    default:
      return 'offline'
  }
}

export interface PayloadServiceInfo {
  id: number
  type: string
  status: ServiceStatus
  payloadStatus: PayloadService['status']
  isHealthy: boolean
  engine: PayloadService['engine']
  currentModel: string | undefined
  currentDevice: string | undefined
  currentBackend: string | undefined
  currentModelType: string | undefined
  currentQuant: string | undefined
  currentSource: string | undefined
  metadata: PayloadService['metadata']
}

async function fetchServices(): Promise<PayloadService[]> {
  const res = await fetch('/api/services')
  if (!res.ok) {
    throw new Error(`Failed to fetch services: ${res.status}`)
  }
  return res.json()
}

function buildServiceInfoMap(
  docs: PayloadService[],
): Record<string, PayloadServiceInfo> {
  const map: Record<string, PayloadServiceInfo> = {}
  for (const doc of docs) {
    map[doc.type] = {
      id: doc.id,
      type: doc.type,
      status: mapPayloadStatus(doc.status),
      payloadStatus: doc.status,
      isHealthy: doc.isHealthy ?? false,
      engine: doc.engine,
      currentModel: doc.models?.default?.name,
      currentDevice: doc.models?.default?.device,
      currentBackend: doc.models?.default?.backend ?? undefined,
      currentModelType: doc.models?.default?.type ?? undefined,
      currentQuant: doc.models?.default?.quant ?? undefined,
      currentSource: doc.models?.default?.source ?? undefined,
      metadata: doc.metadata ?? undefined,
    }
  }
  return map
}

/**
 * Fetches and polls all services from PayloadCMS.
 * Returns serviceInfoMap, statusMap, and query status.
 */
export function useServicesQuery() {
  const query = useQuery({
    queryKey: SERVICES_QUERY_KEY,
    queryFn: fetchServices,
    refetchInterval: POLL_INTERVAL,
  })

  const serviceInfoMap = query.data ? buildServiceInfoMap(query.data) : {}

  const statusMap: Record<string, ServiceStatus> = {}
  for (const [type, info] of Object.entries(serviceInfoMap)) {
    statusMap[type] = info.status
  }

  return {
    statusMap,
    serviceInfoMap,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  }
}

interface ServiceActionVariables {
  serviceId: number
  serviceType: string
  action: 'start' | 'stop' | 'restart'
}

async function performServiceAction({
  serviceId,
  action,
}: ServiceActionVariables): Promise<void> {
  const res = await fetch(`/api/services/${serviceId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
  if (!res.ok) {
    throw new Error(`Service action "${action}" failed: ${res.status}`)
  }
}

/**
 * Mutation hook for service start/stop/restart actions.
 * Automatically invalidates the services query on success.
 * Tracks pending action per service type.
 */
export function useServiceAction() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: performServiceAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY })
    },
  })

  const pendingServiceType =
    mutation.isPending && mutation.variables
      ? mutation.variables.serviceType
      : null

  const isActionPending = useCallback(
    (serviceType: string) => serviceType === pendingServiceType,
    [pendingServiceType],
  )

  return {
    mutate: mutation.mutate,
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
    pendingServiceType,
    isActionPending,
  }
}

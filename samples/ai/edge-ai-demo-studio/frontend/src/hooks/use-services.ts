// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  getInstanceApiBase,
  getInstanceKey,
  getInstanceLabel,
  pickPrimaryInstance,
} from '@/lib/instances/instances'
import type { Service as PayloadService } from '@/payload-types'
import { metaMap } from '@/services/_generated/meta'
import {
  instancePreference,
  mapPayloadStatus,
  type ServiceAction,
  type ServiceStatus,
} from '@/lib/instances/service-status'
import type { DeviceBackend, ModelSource } from '@/services/types'
import type {
  AppliedConfig,
  ServiceRuntimeFields,
  StartupTelemetry,
} from '@/lib/instances/runtime-fields'
import { fetchJson, postJson } from '@/lib/browser/fetch-json'

export const SERVICES_QUERY_KEY = ['services'] as const
const POLL_INTERVAL = 5000

/** One `services` row, keyed in `serviceInfoMap` by its instance key `type@instanceId`. */
export interface PayloadServiceInfo {
  id: number
  type: string
  instanceId: string
  label: string
  instanceKey: string
  apiBase: string
  port: number | undefined
  status: ServiceStatus
  payloadStatus: PayloadService['status']
  isHealthy: boolean
  /** Why the row is in `error`, when the app knows. */
  statusMessage: string | undefined
  /** Epoch ms the current start began: `updatedAt`, set on entering `prepare` (the server timeout's clock). */
  startingSince: number | undefined
  engine: PayloadService['engine']
  /** The row's own check: an engine-backed row uses its backend's. */
  healthCheck: PayloadService['healthCheck']
  currentModel: string | undefined
  currentDevice: string | undefined
  currentBackend: DeviceBackend | undefined
  currentModelType: string | undefined
  currentQuant: string | undefined
  currentSource: ModelSource | undefined
  metadata: PayloadService['metadata']
  /** What its running process was started with (server memory); `null`: nothing runs. */
  applied: AppliedConfig | null
  /** What the current (or failed) start reported; absent when nothing was. */
  startup: StartupTelemetry | undefined
}

function toModelSource(source: unknown): ModelSource | undefined {
  return source === 'huggingface' || source === 'modelscope'
    ? source
    : undefined
}

const DEVICE_BACKENDS: readonly DeviceBackend[] = [
  'openvino',
  'pytorch',
  'vulkan',
  'llamacpp',
]

function toDeviceBackend(backend: unknown): DeviceBackend | undefined {
  return DEVICE_BACKENDS.find((b) => b === backend)
}

/** `GET /api/services`: every row. */
export function fetchServices(): Promise<PayloadService[]> {
  return fetchJson('/api/services', {
    errorMessage: 'Failed to fetch services',
  })
}

function toServiceInfo(
  doc: PayloadService & ServiceRuntimeFields,
): PayloadServiceInfo {
  return {
    id: doc.id,
    type: doc.type,
    instanceId: doc.instanceId,
    label: getInstanceLabel(doc),
    instanceKey: getInstanceKey(doc),
    apiBase: getInstanceApiBase(doc),
    port: doc.port ?? undefined,
    status: mapPayloadStatus(doc.status),
    payloadStatus: doc.status,
    isHealthy: doc.isHealthy ?? false,
    statusMessage: doc.statusMessage?.trim() || undefined,
    startingSince:
      mapPayloadStatus(doc.status) === 'starting'
        ? Date.parse(doc.updatedAt)
        : undefined,
    engine: doc.engine,
    healthCheck: doc.healthCheck,
    currentModel: doc.models?.default?.name,
    currentDevice: doc.models?.default?.device,
    currentBackend: toDeviceBackend(doc.models?.default?.backend),
    currentModelType: doc.models?.default?.type ?? undefined,
    currentQuant: doc.models?.default?.quant ?? undefined,
    currentSource: toModelSource(doc.models?.default?.source),
    metadata: doc.metadata ?? undefined,
    applied: doc.applied ?? null,
    startup: doc.startup ?? undefined,
  }
}

/** The row behind an instance key, or a bare type's primary row (running, else first created). */
export function resolveServiceInfo(
  map: Record<string, PayloadServiceInfo>,
  keyOrType: string,
): PayloadServiceInfo | undefined {
  if (keyOrType.includes('@')) return map[keyOrType]
  const rows = Object.values(map)
    .filter((info) => info.type === keyOrType)
    .sort((a, b) => a.id - b.id)
  return pickPrimaryInstance(rows, (info) => instancePreference(info.status))
}

function buildServiceInfoMap(
  docs: PayloadService[],
): Record<string, PayloadServiceInfo> {
  const map: Record<string, PayloadServiceInfo> = {}
  for (const doc of docs) {
    const info = toServiceInfo(doc)
    map[info.instanceKey] = info
  }
  return map
}

const EMPTY_MAP: Record<string, PayloadServiceInfo> = {}

/**
 * Polls all service rows. Leaves `isFetching` unread on purpose: react-query re-renders only for
 * fields a caller reads, and that one flips on every poll.
 */
export function useServicesQuery() {
  const query = useQuery({
    queryKey: SERVICES_QUERY_KEY,
    queryFn: fetchServices,
    refetchInterval: POLL_INTERVAL,
    select: buildServiceInfoMap,
  })

  return {
    serviceInfoMap: query.data ?? EMPTY_MAP,
    /** A list has loaded at least once (a later refresh may still fail). */
    hasData: query.data !== undefined,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  }
}

export type { ServiceAction } from '@/lib/instances/service-status'

interface ServiceActionVariables {
  /** `undefined` when the type has no instance yet. */
  serviceId: number | undefined
  serviceType: string
  /** Instance key or service type, to track pending state. */
  serviceKey: string
  action: ServiceAction
}

export function patchServiceAction(
  dbId: number,
  action: ServiceAction,
): Promise<void> {
  return postJson(
    `/api/services/${dbId}`,
    { action },
    { method: 'PATCH', errorMessage: `Service action "${action}" failed` },
  )
}

async function performServiceAction({
  serviceId,
  serviceType,
  action,
}: ServiceActionVariables): Promise<void> {
  if (serviceId !== undefined) {
    await patchServiceAction(serviceId, action)
    return
  }
  // A service with no row yet: starting it adds one instance from its defaults, autostarted.
  if (action !== 'start') {
    throw new Error(`${serviceType} has no instance to ${action}`)
  }
  await postJson(
    '/api/services',
    {
      type: serviceType,
      label: metaMap[serviceType as keyof typeof metaMap]?.name ?? serviceType,
      autostart: true,
    },
    { errorMessage: 'Failed to add the service' },
  )
}

const SERVICE_ACTION_MUTATION_KEY = ['service-action'] as const

/** Start/stop/restart mutation, tracking every pending action by instance key. */
export function useServiceAction() {
  const queryClient = useQueryClient()

  // `mutateAsync`, not `mutate`: `mutate` reports only to its latest call, so of two instances
  // stopped at once only one would settle.
  const { mutateAsync: run } = useMutation({
    mutationKey: SERVICE_ACTION_MUTATION_KEY,
    mutationFn: performServiceAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY })
    },
  })

  const pending = useMutationState({
    filters: { mutationKey: SERVICE_ACTION_MUTATION_KEY, status: 'pending' },
    select: (m) => m.state.variables as ServiceActionVariables | undefined,
  })

  const getPendingAction = (serviceKey: string): ServiceAction | null =>
    pending.findLast((v) => v?.serviceKey === serviceKey)?.action ?? null

  const isActionPending = (serviceKey: string) =>
    getPendingAction(serviceKey) !== null

  return {
    run,
    isActionPending,
    getPendingAction,
  }
}

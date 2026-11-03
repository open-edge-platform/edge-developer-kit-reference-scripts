// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { DEFAULT_MAX_INSTANCES } from '@/lib/instances/instances'
import type { Service, ServiceStatus } from '@/services/types'
import { hasExecutionMode } from '@/services/execution'

/**
 * How every surface words a service and its instances. Availability and attention are kept apart:
 * one running and one failed instance is both running and in need of attention.
 */

export type ServiceMembership =
  'added' | 'not-added' | 'built-in' | 'unavailable'

/** `built-in` runs inside the studio (opened, never added); `unavailable` wins over everything. */
export function getServiceMembership(
  service: Pick<Service, 'execution' | 'added'>,
  supported: boolean,
): ServiceMembership {
  if (!supported) return 'unavailable'
  if (hasExecutionMode(service.execution, 'none')) return 'built-in'
  return service.added ? 'added' : 'not-added'
}

export const MEMBERSHIP_LABEL: Record<ServiceMembership, string> = {
  added: 'Added',
  'not-added': 'Not added',
  'built-in': 'Built-in',
  unavailable: 'Unavailable',
}

export const STATE_LABEL: Record<ServiceStatus, string> = {
  online: 'Running',
  starting: 'Starting',
  error: 'Failed',
  offline: 'Stopped',
}

/** A built-in has nothing to start or stop: it is available whenever the studio runs. */
export function serviceStateLabel(
  service: Pick<Service, 'execution'>,
  status: ServiceStatus,
): string {
  return hasExecutionMode(service.execution, 'none')
    ? 'Available'
    : STATE_LABEL[status]
}

const AVAILABILITY_RANK: Record<ServiceStatus, number> = {
  online: 3,
  starting: 2,
  error: 1,
  offline: 0,
}

const ATTENTION_RANK: Record<ServiceStatus, number> = {
  error: 3,
  starting: 2,
  online: 1,
  offline: 0,
}

function highestRanked(
  statuses: readonly ServiceStatus[],
  rank: Record<ServiceStatus, number>,
): ServiceStatus {
  let best: ServiceStatus = 'offline'
  for (const s of statuses) {
    if (rank[s] > rank[best]) best = s
  }
  return best
}

/** Best status across instances: "is any of this working?", the question for a proxy target. */
export function aggregateInstanceStatus(
  statuses: readonly ServiceStatus[],
): ServiceStatus {
  return highestRanked(statuses, AVAILABILITY_RANK)
}

/**
 * Status most needing attention across instances, for overview surfaces: one running instance must
 * not turn a service green and hide a failed sibling.
 */
export function getAttentionStatus(
  service: Pick<Service, 'status' | 'instances'>,
): ServiceStatus {
  const instances = service.instances ?? []
  if (instances.length === 0) return service.status
  return highestRanked(
    instances.map((i) => i.status),
    ATTENTION_RANK,
  )
}

/** Only `online` counts as running. */
export interface InstanceCounts {
  total: number
  running: number
  starting: number
  failed: number
  stopped: number
}

export function countInstances(
  instances: readonly { status: ServiceStatus }[],
): InstanceCounts {
  const counts: InstanceCounts = {
    total: instances.length,
    running: 0,
    starting: 0,
    failed: 0,
    stopped: 0,
  }
  for (const { status } of instances) {
    if (status === 'online') counts.running++
    else if (status === 'starting') counts.starting++
    else if (status === 'error') counts.failed++
    else counts.stopped++
  }
  return counts
}

/** States in the order a summary names them: what works, then what does not. */
export const SUMMARY_STATES = [
  ['running', 'online'],
  ['starting', 'starting'],
  ['failed', 'error'],
  ['stopped', 'offline'],
] as const satisfies readonly (readonly [
  Exclude<keyof InstanceCounts, 'total'>,
  ServiceStatus,
])[]

/** "3 instances · 1 running · 1 failed · 1 stopped" */
export function instanceSummary(
  instances: readonly { status: ServiceStatus }[],
): string {
  const counts = countInstances(instances)
  const total = `${counts.total} ${counts.total === 1 ? 'instance' : 'instances'}`
  const states = SUMMARY_STATES.filter(([key]) => counts[key] > 0).map(
    ([key]) => `${counts[key]} ${key}`,
  )
  return [total, ...states].join(' · ')
}

export type ServiceFilter =
  'all' | 'added' | 'running' | 'stopped' | 'attention'

/** Matches when any instance is in that state, so a service can be Running and Needs attention. */
export function matchesServiceFilter(
  service: Pick<Service, 'added' | 'instances'>,
  filter: ServiceFilter,
): boolean {
  const counts = countInstances(service.instances ?? [])
  switch (filter) {
    case 'added':
      return Boolean(service.added)
    case 'running':
      return counts.running > 0
    case 'stopped':
      return counts.stopped > 0
    case 'attention':
      return counts.failed > 0
    default:
      return true
  }
}

/** Searches the service's name, description and defaults, and each instance's name, model and device. */
export function matchesServiceSearch(service: Service, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const fields: (string | undefined)[] = [
    service.name,
    service.id,
    service.description,
    service.model,
    service.hardware,
    service.defaultModel?.name,
    service.defaultModel?.device,
  ]
  for (const instance of service.instances ?? []) {
    fields.push(
      instance.label,
      instance.instanceId,
      instance.currentModel,
      instance.currentDevice,
    )
  }
  return fields.some((field) => field?.toLowerCase().includes(q))
}

/** The model / device / backend an instance runs, its defaults until started. */
export function instanceRuntime(
  instance: Pick<
    Service,
    'currentModel' | 'currentDevice' | 'currentBackend' | 'defaultModel'
  >,
) {
  return {
    model: instance.currentModel ?? instance.defaultModel?.name,
    device: instance.currentDevice ?? instance.defaultModel?.device,
    backend: instance.currentBackend ?? instance.defaultModel?.backend,
  }
}

export function instanceLimit(
  service: Pick<Service, 'multiInstance' | 'maxInstances'>,
): number {
  return service.multiInstance
    ? (service.maxInstances ?? DEFAULT_MAX_INSTANCES)
    : 1
}

/** Whether Add instance is offered for an added service, and why not. */
export function addInstanceAvailability(
  service: Pick<Service, 'multiInstance' | 'maxInstances'> & {
    instances?: readonly unknown[]
  },
): { allowed: true } | { allowed: false; reason: string } {
  const count = service.instances?.length ?? 0
  if (!service.multiInstance) {
    return { allowed: false, reason: 'This service runs a single instance.' }
  }
  const max = instanceLimit(service)
  if (count >= max) {
    return {
      allowed: false,
      reason: `Limit of ${max} instances reached. Delete one to add another.`,
    }
  }
  return { allowed: true }
}

/** The tabs of a service page an address can open on (`?tab=`). */
export type InstanceTab = 'demo' | 'docs' | 'logs'

export interface ServiceHrefOptions {
  instanceId?: string
  tab?: InstanceTab
  logLevel?: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'
  /** `worker` (the instance's own process log), `engine` (its engine's log) or a source's label. */
  logSource?: string
}

/**
 * Encoded address of a service's page (its primary instance unless `instanceId` names another);
 * `logLevel` and `logSource` open the Logs tab already filtered.
 */
export function serviceHref(
  serviceType: string,
  { instanceId, tab, logLevel, logSource }: ServiceHrefOptions = {},
): string {
  const params = new URLSearchParams()
  if (instanceId) params.set('instance', instanceId)
  if (tab) params.set('tab', tab)
  if (logLevel) params.set('level', logLevel)
  if (logSource) params.set('source', logSource)
  const query = params.toString()
  return `/services/${encodeURIComponent(serviceType)}${query ? `?${query}` : ''}`
}

/** Where every Add service action leads. */
export const CATALOG_HREF = '/services'

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * An instance's stored status (on the `services` row) and UI status, with everything derived from
 * them, so server and UI agree on what "running" means. Isomorphic: imports types only.
 */

import type { Service } from '@/payload-types'

export type PayloadStatus = NonNullable<Service['status']>

/** The status the UI shows for an instance (or a service). */
export type ServiceStatus = 'online' | 'offline' | 'error' | 'starting'

/** `PATCH /api/services/:id { action }` */
export const SERVICE_ACTIONS = ['start', 'stop', 'restart'] as const
export type ServiceAction = (typeof SERVICE_ACTIONS)[number]

export function mapPayloadStatus(
  status: Service['status'] | undefined,
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

/** A service (or instance) that has a process: online, or still starting. */
export function isRunningStatus(status: ServiceStatus): boolean {
  return status === 'online' || status === 'starting'
}

/** Rank for `pickPrimaryInstance`: online, then starting, then stopped or failed. */
export function instancePreference(status: ServiceStatus): number {
  if (status === 'online') return 0
  if (status === 'starting') return 1
  return 2
}

/** Statuses a row passes through while starting or restarting. */
export function isTransientStatus(
  status: Service['status'] | undefined,
): boolean {
  return mapPayloadStatus(status) === 'starting'
}

/** Statuses in which a process exists (or is being brought up). */
export function isRunningPayloadStatus(
  status: Service['status'] | undefined,
): boolean {
  return isRunningStatus(mapPayloadStatus(status))
}

export function payloadInstancePreference(
  status: Service['status'] | undefined,
): number {
  return instancePreference(mapPayloadStatus(status))
}

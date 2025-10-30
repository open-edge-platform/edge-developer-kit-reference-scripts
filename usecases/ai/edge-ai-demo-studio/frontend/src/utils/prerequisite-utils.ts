// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Workload } from '@/payload-types'
import type { CreateWorkload, UpdateWorkload } from '@/hooks/use-workload'
import { UseMutationResult } from '@tanstack/react-query'
import { getDefaultWorkload } from './common'

export interface WorkloadStatus {
  id: number
  type: string
  status: ('prepare' | 'active' | 'inactive' | 'error') | null
}

export interface PrerequisiteService {
  id: number
  name: string
  status: string
}

/**
 * Gets the list of inactive prerequisite services
 * @param prerequisiteServices - Array of service names that are prerequisites
 * @param workloads - Array of current workload statuses
 * @returns Array of inactive prerequisite service names, or null if no prerequisites or workloads
 */
export function getInactivePrerequisites(
  prerequisiteServices?: string[],
  workloads?: WorkloadStatus[],
) {
  if (prerequisiteServices && prerequisiteServices.length > 0) {
    if (workloads && workloads.length > 0) {
      const runningServices = workloads
        .filter((wl) => wl.status === 'active' || wl.status === 'prepare')
        .map((wl) => wl.type)

      const notRunning = prerequisiteServices.filter(
        (service) => !runningServices.includes(service as Workload['type']),
      )
      return notRunning
    }
    return prerequisiteServices
  }
  return []
}

/**
 * Gets the list of prerequisite services that are currently in preparing state
 * @param prerequisiteServices - Array of service names that are prerequisites
 * @param workloads - Array of current workload statuses
 * @returns Array of prerequisite service names that are currently preparing
 */
export function getPreparingPrerequisites(
  prerequisiteServices?: string[],
  workloads?: WorkloadStatus[],
) {
  if (prerequisiteServices && prerequisiteServices.length > 0) {
    if (workloads && workloads.length > 0) {
      const preparingServices = workloads
        .filter((wl) => wl.status === 'prepare')
        .map((wl) => wl.type)

      const preparing = prerequisiteServices.filter((service) =>
        preparingServices.includes(service as Workload['type']),
      )
      return preparing
    }
  }
  return []
}

/**
 * Checks if a workload is active but has inactive prerequisite services
 * @param workload - The current workload
 * @param prerequisiteServices - Array of service names that are prerequisites
 * @param workloads - Array of current workload statuses
 * @returns Array of inactive prerequisite service names if workload is active, empty array otherwise
 */
export function getActiveWorkloadInactivePrerequisites(
  workload?: Workload,
  prerequisiteServices?: string[],
  workloads?: WorkloadStatus[],
) {
  // Only check if the workload is active
  if (!workload || workload.status !== 'active') {
    return []
  }

  // If no prerequisites defined, return empty array
  if (!prerequisiteServices || prerequisiteServices.length === 0) {
    return []
  }

  // Get inactive prerequisites
  return getInactivePrerequisites(prerequisiteServices, workloads)
}

/**
 * Gets the prerequisite services that need to be started
 * @param prerequisiteServices - Array of service names that are prerequisites
 * @param workloads - Array of current workload statuses
 * @returns Array of PrerequisiteService objects for services that need to be started
 */
export function getPrerequisitesToStart(
  prerequisiteServices?: string[],
  workloads?: WorkloadStatus[],
): PrerequisiteService[] {
  if (
    prerequisiteServices &&
    prerequisiteServices.length > 0 &&
    workloads &&
    workloads.length > 0
  ) {
    const runningServices = workloads
      .filter((wl) => wl.status === 'active' || wl.status === 'prepare')
      .map((wl) => wl.type)

    return prerequisiteServices
      .filter(
        (service) => !runningServices.includes(service as Workload['type']),
      )
      .map((service) => {
        const existingWorkload = workloads.find((wl) => wl.type === service)
        return {
          id: existingWorkload?.id ?? 0,
          name: service,
          status: existingWorkload?.status ?? 'not-exists',
        }
      })
  } else if (!workloads || workloads.length === 0) {
    return (
      prerequisiteServices?.map((service) => ({
        id: 0,
        name: service,
        status: 'not-exists',
      })) || []
    )
  }
  return []
}

/**
 * Starts prerequisite services by creating or updating workloads
 * @param prerequisiteServices - Array of service names that are prerequisites
 * @param workloads - Array of current workload statuses
 * @param createWorkload - Mutation function for creating workloads
 * @param updateWorkload - Mutation function for updating workloads
 */
export function startPrerequisites(
  prerequisiteServices: string[] | undefined,
  workloads: WorkloadStatus[] | undefined,
  createWorkload: UseMutationResult<
    { message: string; doc: Workload },
    Error,
    CreateWorkload,
    unknown
  >,
  updateWorkload: UseMutationResult<
    { message: string; doc: Workload },
    Error,
    { id: number; data: UpdateWorkload },
    unknown
  >,
): void {
  const prerequisitesToStart = getPrerequisitesToStart(
    prerequisiteServices,
    workloads,
  )

  if (prerequisitesToStart.length > 0) {
    prerequisitesToStart.forEach((service) => {
      if (service.status === 'not-exists') {
        const workloadToStart = getDefaultWorkload(
          service.name as Workload['type'],
        )
        if (workloadToStart) {
          createWorkload.mutate({ ...workloadToStart })
        }
      } else {
        updateWorkload.mutate({
          id: service.id,
          data: { status: 'prepare' },
        })
      }
    })
  }
}

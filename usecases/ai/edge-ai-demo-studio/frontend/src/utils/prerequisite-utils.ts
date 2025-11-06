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

export function getActiveWorkloadInactivePrerequisites(
  workload?: Workload | null,
  prerequisiteServices?: string[],
  workloads?: WorkloadStatus[],
) {
  if (!workload || workload.status !== 'active') {
    return []
  }

  if (!prerequisiteServices || prerequisiteServices.length === 0) {
    return []
  }

  return getInactivePrerequisites(prerequisiteServices, workloads)
}

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

// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Workload } from '@/payload-types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PaginatedDocs } from 'payload'
import { stringify } from 'qs-esm'
import type { Where } from 'payload'
import isEqual from 'fast-deep-equal'

const TIMEOUT_TIMER = 500

export const useGetWorkloads = () => {
  return useQuery({
    queryKey: ['workloads'],
    queryFn: async () => {
      const response = await fetch('/api/workloads')
      if (!response.ok) {
        throw new Error('Network response was not ok')
      }
      return (await response.json()) as PaginatedDocs<Workload>
    },
  })
}

export const useGetWorkloadsStatus = () => {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: ['workloads', 'status'],
    queryFn: async () => {
      const response = await fetch('/api/workloads/status')
      if (!response.ok) {
        throw new Error('Network response was not ok')
      }
      return (await response.json()) as {
        id: number
        type: string
        status: ('prepare' | 'active' | 'inactive' | 'error') | null
      }[]
    },
    refetchInterval: 10000,
    structuralSharing: (oldData, newData) => {
      if (isEqual(oldData, newData)) {
        return oldData
      }
      queryClient.invalidateQueries({ queryKey: ['workloads'] })
      return newData
    },
  })
}

export const useGetWorkloadByType = (type: string) => {
  const queryClient = useQueryClient()
  const query: Where = {
    type: {
      equals: type,
    },
  }
  const stringifiedQuery = stringify(
    {
      where: query,
      limit: 1,
    },
    { addQueryPrefix: true },
  )
  return useQuery({
    queryKey: ['workloads', { type }],
    queryFn: async () => {
      const response = await fetch(`/api/workloads${stringifiedQuery}`)
      if (!response.ok) {
        throw new Error('Network response was not ok')
      }

      const data = (await response.json()) as PaginatedDocs<Workload>
      if (!data.docs || data.docs.length === 0) {
        return response.json() as Promise<undefined>
      }
      // Return the first workload found
      if (data.docs.length > 1) {
        console.warn(
          `Multiple workloads found for type ${type}. Returning the first one.`,
        )
      }
      return data.docs[0]
    },
    structuralSharing: (oldData, newData) => {
      if (isEqual(oldData, newData)) {
        return oldData
      }
      queryClient.invalidateQueries({ queryKey: ['workloads'] })
      return newData
    },
    refetchInterval: 10000,
  })
}

export interface CreateWorkload {
  name: string
  type: Workload['type']
  model?: string
  device?: string
  port?: number
  healthUrl?: string
  status?: Workload['status']
  metadata?: Workload['metadata']
}

export const useCreateWorkload = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (workload: CreateWorkload) => {
      const response = await fetch('/api/workloads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(workload),
      })
      if (!response.ok) {
        throw new Error('Network response was not ok')
      }
      return response.json() as Promise<{ message: string; doc: Workload }>
    },
    onSuccess: async () => {
      //Timeout to wait for payload hooks to finish running
      await new Promise((resolve) =>
        setTimeout(() => {
          queryClient
            .invalidateQueries({ queryKey: ['workloads'] })
            .then(() => {
              resolve(1)
            })
        }, TIMEOUT_TIMER),
      )
    },
  })
}

export interface UpdateWorkload {
  name?: string
  model?: string
  device?: string
  metadata?: Workload['metadata']
  status?: Workload['status']
}

export const useUpdateWorkload = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: UpdateWorkload }) => {
      const response = await fetch(`/api/workloads/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...data, statusMessage: '' }),
      })
      if (!response.ok) {
        throw new Error('Network response was not ok')
      }
      return response.json() as Promise<{ message: string; doc: Workload }>
    },
    onSuccess: async () => {
      await new Promise((resolve) =>
        //Timeout to wait for payload hooks to finish running
        setTimeout(() => {
          queryClient
            .invalidateQueries({ queryKey: ['workloads'] })
            .then(() => {
              resolve(1)
            })
        }, TIMEOUT_TIMER),
      )
    },
  })
}

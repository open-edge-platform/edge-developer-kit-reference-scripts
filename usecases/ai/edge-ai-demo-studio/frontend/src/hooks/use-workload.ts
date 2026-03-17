// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Workload } from '@/payload-types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PaginatedDocs } from 'payload'
import { stringify } from 'qs-esm'
import type { Where } from 'payload'
import isEqual from 'fast-deep-equal'
import {
  CreateWorkload,
  ModelList,
  ModelTypes,
  UpdateWorkload,
} from '@/types/workload'
import { logger } from '@/utils/logger'
import { useEffect, useRef, useState } from 'react'

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

export const useGetWorkloadModels = (
  type: Workload['type'] | 'rerank',
  engine: Workload['engine'],
) => {
  return useQuery({
    queryKey: ['workload', 'models', type, engine],
    queryFn: async () => {
      const response = await fetch(`/api/models?type=${type}&engine=${engine}`)
      if (!response.ok) {
        throw new Error('Network response was not ok')
      }
      return (await response.json()) as ModelList
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
        return null
      }
      // Return the first workload found
      if (data.docs.length > 1) {
        logger.warn(
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

export const useDeleteWorkloadModel = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      engine,
      type,
      name,
    }: {
      engine: Workload['engine']
      type: Workload['type']
      name: string
    }) => {
      const response = await fetch('/api/models', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ engine, workloadType: type, name }),
      })
      if (!response.ok) {
        throw new Error('Network response was not ok')
      }
      return response.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['workload', 'models', variables.type, variables.engine],
      })
    },
  })
}

export const useUploadLocalModel = () => {
  const [uploadProgress, setUploadProgress] = useState(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const CHUNK_SIZE = 10 * 1024 * 1024 // 10MB

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  const cancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    setUploadProgress(0)
  }

  const mutation = useMutation({
    mutationFn: async ({
      file,
      engine,
      type,
      task,
      modelName,
    }: {
      file: File
      engine: Workload['engine']
      type: ModelTypes
      task: string
      modelName: string
    }) => {
      setUploadProgress(0)
      abortControllerRef.current = new AbortController()
      const signal = abortControllerRef.current.signal

      // 1. Upload chunks via API route
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
      let uploadedFilePath = ''

      for (let i = 0; i < totalChunks; i++) {
        if (signal.aborted) {
          throw new DOMException('Upload cancelled', 'AbortError')
        }

        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, file.size)
        const chunk = file.slice(start, end)

        const formData = new FormData()
        // API Route requires these for routing
        formData.append('engine', engine)
        formData.append('workload_type', type)

        // Backend requires these
        formData.append('repo_id', modelName)
        formData.append('task', task.replace('-', '_'))
        formData.append('chunk_index', i.toString())
        formData.append('total_chunks', totalChunks.toString())
        formData.append('file', chunk, file.name)
        formData.append('force_override', 'true')

        const response = await fetch('/api/models', {
          method: 'POST',
          body: formData,
          signal,
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || error.detail || 'Upload failed')
        }

        const data = await response.json()

        if (data.tempPath) {
          uploadedFilePath = data.tempPath
        }

        // Update progress
        setUploadProgress(Math.round(((i + 1) / totalChunks) * 100))
      }

      return uploadedFilePath
    },
    onError: (error) => {
      if (error.name !== 'AbortError') {
        setUploadProgress(0)
      }
    },
  })

  return { ...mutation, uploadProgress, cancel }
}

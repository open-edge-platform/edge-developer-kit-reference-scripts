// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery } from '@tanstack/react-query'

interface RobotTypeResponse {
  type: string | null
}

interface RobotTypesResponse {
  types: string[]
}

interface RobotPort {
  device: string
  description: string
  manufacturer: string
}

interface RobotPortsResponse {
  ports: RobotPort[]
}

interface SetRobotTypeResponse {
  status: boolean
  type: string
  port: string
  message: string
}

export function useRobotTypeQuery(workerBaseUrl: string) {
  return useQuery({
    queryKey: ['robot-type', workerBaseUrl],
    queryFn: async (): Promise<RobotTypeResponse> => {
      const response = await fetch(`${workerBaseUrl}/robot/type`)
      if (!response.ok) throw new Error(`Failed with status ${response.status}`)
      return response.json()
    },
    retry: false,
    staleTime: 0,
  })
}

export function useRobotTypesQuery(workerBaseUrl: string) {
  return useQuery({
    queryKey: ['robot-types', workerBaseUrl],
    queryFn: async (): Promise<RobotTypesResponse> => {
      const response = await fetch(`${workerBaseUrl}/robot/types`)
      if (!response.ok) throw new Error(`Failed with status ${response.status}`)
      return response.json()
    },
    retry: false,
  })
}

export function useRobotPortsQuery(workerBaseUrl: string) {
  return useQuery({
    queryKey: ['robot-ports', workerBaseUrl],
    queryFn: async (): Promise<RobotPortsResponse> => {
      const response = await fetch(`${workerBaseUrl}/robot/ports`)
      if (!response.ok) throw new Error(`Failed with status ${response.status}`)
      return response.json()
    },
    retry: false,
  })
}

export function useSetRobotTypeMutation() {
  return useMutation({
    mutationFn: async ({
      workerBaseUrl,
      type,
      port,
    }: {
      workerBaseUrl: string
      type: string
      port?: string
    }): Promise<SetRobotTypeResponse> => {
      const response = await fetch(`${workerBaseUrl}/robot/type`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, port }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        const detail = body?.detail ?? `Failed with status ${response.status}`
        throw new Error(detail)
      }
      return response.json()
    },
  })
}

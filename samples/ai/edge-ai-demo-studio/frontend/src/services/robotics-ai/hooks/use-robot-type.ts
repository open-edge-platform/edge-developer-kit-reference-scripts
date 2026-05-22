// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery } from '@tanstack/react-query'

interface RobotTypeResponse {
  type: string | null
}

interface RobotTypesResponse {
  types: string[]
}

interface SetRobotTypeResponse {
  status: boolean
  type: string
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

export function useSetRobotTypeMutation() {
  return useMutation({
    mutationFn: async ({
      workerBaseUrl,
      type,
    }: {
      workerBaseUrl: string
      type: string
    }): Promise<SetRobotTypeResponse> => {
      const response = await fetch(`${workerBaseUrl}/robot/type`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      if (!response.ok) throw new Error(`Failed with status ${response.status}`)
      return response.json()
    },
  })
}

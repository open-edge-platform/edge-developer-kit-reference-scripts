// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery } from '@tanstack/react-query'

export interface GripperConfig {
  gripper_open: number
  gripper_close: number
}

interface SetGripperConfigResponse {
  status: boolean
  gripper_open: number
  gripper_close: number
  message: string
}

export function useGripperConfigQuery(workerBaseUrl: string) {
  return useQuery({
    queryKey: ['gripper-config', workerBaseUrl],
    queryFn: async (): Promise<GripperConfig> => {
      const response = await fetch(`${workerBaseUrl}/robot/gripper-config`)
      if (!response.ok) throw new Error(`Failed with status ${response.status}`)
      return response.json()
    },
    retry: false,
    staleTime: 0,
  })
}

export function useSetGripperConfigMutation() {
  return useMutation({
    mutationFn: async ({
      workerBaseUrl,
      gripperOpen,
      gripperClose,
    }: {
      workerBaseUrl: string
      gripperOpen: number
      gripperClose: number
    }): Promise<SetGripperConfigResponse> => {
      const response = await fetch(`${workerBaseUrl}/robot/gripper-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gripper_open: gripperOpen,
          gripper_close: gripperClose,
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(
          (body as { detail?: string }).detail ??
            `Request failed with status ${response.status}`,
        )
      }
      return response.json()
    },
  })
}

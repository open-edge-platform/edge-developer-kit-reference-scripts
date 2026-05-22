// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query'

interface CameraStatusResponse {
  ready: boolean
}

export function useCameraStatusQuery(
  workerBaseUrl: string,
  enabled: boolean,
  refetchInterval: number | false = 1000,
) {
  return useQuery({
    queryKey: ['camera-status', workerBaseUrl],
    queryFn: async (): Promise<CameraStatusResponse> => {
      const response = await fetch(`${workerBaseUrl}/camera/status`)
      if (!response.ok) throw new Error(`Failed with status ${response.status}`)
      return response.json()
    },
    enabled,
    refetchInterval,
    retry: false,
  })
}

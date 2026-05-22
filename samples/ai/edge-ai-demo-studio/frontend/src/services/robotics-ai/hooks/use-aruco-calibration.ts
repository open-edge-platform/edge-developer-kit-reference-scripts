// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery } from '@tanstack/react-query'

export interface ArucoDetectResult {
  detected: boolean
  bbox: [number, number, number, number] | null
  marker0_center: [number, number] | null
  marker1_center: [number, number] | null
  centroid: [number, number] | null
  frame_center: [number, number] | null
  aligned: boolean | null
  offset_x: number | null
  offset_y: number | null
  message: string
}

export interface ArucoCalibrateResult extends ArucoDetectResult {
  status: boolean
}

export function useArucoDetectQuery(workerBaseUrl: string, enabled: boolean) {
  return useQuery({
    queryKey: ['aruco-detect', workerBaseUrl],
    queryFn: async (): Promise<ArucoDetectResult> => {
      const response = await fetch(`${workerBaseUrl}/camera/aruco-detect`)
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(
          (body as { detail?: string }).detail ??
            `Request failed with status ${response.status}`,
        )
      }
      return response.json()
    },
    enabled,
    refetchInterval: enabled ? 1500 : false,
    retry: false,
  })
}

export function useArucoCalibrateMutation() {
  return useMutation({
    mutationFn: async ({
      workerBaseUrl,
    }: {
      workerBaseUrl: string
    }): Promise<ArucoCalibrateResult> => {
      const response = await fetch(`${workerBaseUrl}/camera/aruco-calibrate`, {
        method: 'POST',
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

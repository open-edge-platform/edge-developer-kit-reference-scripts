// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query'

interface PrerequisitesResponse {
  dialout: boolean
  librealsense: boolean
}

interface CalibrationStatusResponse {
  motor_calibrated: boolean
  camera_calibrated: boolean
  calibration_dir: string
}

export function usePrerequisitesQuery(workerBaseUrl: string) {
  return useQuery({
    queryKey: ['prerequisites', workerBaseUrl],
    queryFn: async (): Promise<PrerequisitesResponse> => {
      const response = await fetch(`${workerBaseUrl}/system/prerequisites`)
      if (!response.ok) throw new Error(`Failed with status ${response.status}`)
      return response.json()
    },
    retry: false,
    staleTime: 30_000,
  })
}

export function useCalibrationStatusQuery(
  workerBaseUrl: string,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: ['calibration-status', workerBaseUrl],
    queryFn: async (): Promise<CalibrationStatusResponse> => {
      const response = await fetch(`${workerBaseUrl}/robot/calibration-status`)
      if (!response.ok) throw new Error(`Failed with status ${response.status}`)
      return response.json()
    },
    retry: false,
    enabled,
    staleTime: 0,
  })
}

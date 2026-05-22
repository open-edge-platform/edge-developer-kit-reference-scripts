// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'

interface CalibrationResponse {
  status: boolean
  state: string
  message: string
}

export function useCalibrationStartMutation() {
  return useMutation({
    mutationFn: async ({
      workerBaseUrl,
    }: {
      workerBaseUrl: string
    }): Promise<CalibrationResponse> => {
      const response = await fetch(`${workerBaseUrl}/robot/calibrate/start`, {
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

export function useCalibrationConfirmMutation() {
  return useMutation({
    mutationFn: async ({
      workerBaseUrl,
    }: {
      workerBaseUrl: string
    }): Promise<CalibrationResponse> => {
      const response = await fetch(`${workerBaseUrl}/robot/calibrate/confirm`, {
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

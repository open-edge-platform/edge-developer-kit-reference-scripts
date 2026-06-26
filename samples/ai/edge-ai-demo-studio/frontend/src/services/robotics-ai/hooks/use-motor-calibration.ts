// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery } from '@tanstack/react-query'

export type MotorCalibrationState =
  | 'idle'
  | 'awaiting_calibration_choice'
  | 'awaiting_middle_position'
  | 'awaiting_range_motion'
  | 'complete'
  | 'error'

export interface JointReading {
  name: string
  min: number
  pos: number
  max: number
}

interface MotorCalibrationStatusResponse {
  state: MotorCalibrationState
  joint_readings: JointReading[]
}

interface MotorCalibrationActionResponse {
  status: boolean
  state: MotorCalibrationState
  message: string
}

export function useMotorCalibrationStatusQuery(
  workerBaseUrl: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['motor-calibration-status', workerBaseUrl],
    queryFn: async (): Promise<MotorCalibrationStatusResponse> => {
      const response = await fetch(
        `${workerBaseUrl}/robot/motor-calibrate/status`,
      )
      if (!response.ok) throw new Error(`Failed with status ${response.status}`)
      return response.json()
    },
    enabled,
    // Stop polling once the process reaches a terminal state
    refetchInterval: (query) => {
      const state = query.state.data?.state
      if (!enabled) return false
      if (state === 'error' || state === 'idle') return false
      return 2500
    },
  })
}

export function useMotorCalibrationStartMutation() {
  return useMutation({
    mutationFn: async ({
      workerBaseUrl,
    }: {
      workerBaseUrl: string
    }): Promise<MotorCalibrationActionResponse> => {
      const response = await fetch(
        `${workerBaseUrl}/robot/motor-calibrate/start`,
        { method: 'POST' },
      )
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

export function useMotorCalibrationNextMutation() {
  return useMutation({
    mutationFn: async ({
      workerBaseUrl,
      choice,
    }: {
      workerBaseUrl: string
      choice?: 'use_existing' | 'run'
    }): Promise<MotorCalibrationActionResponse> => {
      const response = await fetch(
        `${workerBaseUrl}/robot/motor-calibrate/next`,
        {
          method: 'POST',
          headers: choice ? { 'Content-Type': 'application/json' } : {},
          body: choice ? JSON.stringify({ choice }) : undefined,
        },
      )
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

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { requireApiBase } from '@/lib/browser/api-base'
import {
  advanceMotorCalibration,
  fetchCalibrationStatus,
  fetchMotorCalibrationStatus,
  isMotorCalibrationWaiting,
  type MotorCalibrationChoice,
  type MotorCalibrationState,
  ROBOTICS_SERVICE,
  roboticsKey,
  startMotorCalibration,
} from '../lib/api'

/** Whether the motors and the camera are calibrated; asked once the worker has a robot type. */
export function useCalibrationStatus(
  workerBaseUrl: string | undefined,
  robotTypeReady: boolean,
) {
  return useQuery({
    queryKey: roboticsKey('calibration-status', workerBaseUrl),
    queryFn: () => {
      requireApiBase(workerBaseUrl, ROBOTICS_SERVICE)
      return fetchCalibrationStatus(workerBaseUrl)
    },
    retry: false,
    enabled: robotTypeReady && workerBaseUrl !== undefined,
    staleTime: 0,
  })
}

/** One step of the motor calibration: start it, or answer the step it waits on. */
type MotorStep =
  { action: 'start' } | { action: 'next'; choice?: MotorCalibrationChoice }

/**
 * The motor calibration session (LeRobot's follower calibration, step by step on the worker).
 * While it waits on the user, the worker's state and joint readings are polled.
 */
export function useMotorCalibration(workerBaseUrl: string | undefined) {
  const queryClient = useQueryClient()
  // The state the worker answered the last step with.
  const [answered, setAnswered] = useState<MotorCalibrationState>('idle')
  const waiting = isMotorCalibrationWaiting(answered)

  const step = useMutation({
    mutationFn: (next: MotorStep) => {
      requireApiBase(workerBaseUrl, ROBOTICS_SERVICE)
      return next.action === 'start'
        ? startMotorCalibration(workerBaseUrl)
        : advanceMotorCalibration(workerBaseUrl, next.choice)
    },
    onSuccess: (answer) => {
      setAnswered(answer.state)
      if (answer.state === 'complete') {
        queryClient.invalidateQueries({
          queryKey: roboticsKey('calibration-status', workerBaseUrl),
        })
      }
    },
  })

  const status = useQuery({
    queryKey: roboticsKey('motor-calibration-status', workerBaseUrl),
    queryFn: () => {
      requireApiBase(workerBaseUrl, ROBOTICS_SERVICE)
      return fetchMotorCalibrationStatus(workerBaseUrl)
    },
    enabled: waiting && workerBaseUrl !== undefined,
    refetchInterval: (query) => {
      const state = query.state.data?.state
      return state === 'error' || state === 'idle' ? false : 2500
    },
  })

  // While polled, the worker's state is fresher. Once a step answers a terminal state, polling
  // stops and that answer wins over the last poll, or the previous step's buttons would stay.
  const state = waiting ? (status.data?.state ?? answered) : answered
  const message = step.data?.message ?? null
  const pending = step.isPending ? step.variables : undefined

  return {
    state,
    jointReadings: status.data?.joint_readings ?? [],
    /** What the last step answered; cleared while the next one runs. */
    message,
    error: step.error
      ? step.error.message
      : state === 'error' && !message
        ? 'Motor calibration process exited unexpectedly. Please try again.'
        : null,
    isStarting: pending?.action === 'start',
    isAdvancing: pending?.action === 'next',
    /** The choice being sent, while one is. */
    pendingChoice: pending?.action === 'next' ? pending.choice : undefined,
    start: () => step.mutate({ action: 'start' }),
    advance: (choice?: MotorCalibrationChoice) =>
      step.mutate({ action: 'next', choice }),
  }
}

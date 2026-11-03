// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { requireApiBase } from '@/lib/browser/api-base'
import {
  calibrateAruco,
  detectAruco,
  ROBOTICS_SERVICE,
  roboticsKey,
} from '../lib/api'

/**
 * The camera's workspace calibration: detect the two ArUco markers live
 * (polled while detection is on), then save the bounding box they span.
 */
export function useArucoCalibration(workerBaseUrl: string | undefined) {
  const queryClient = useQueryClient()
  const [detecting, setDetecting] = useState(false)
  const polled = detecting && workerBaseUrl !== undefined
  const detection = useQuery({
    queryKey: roboticsKey('aruco-detect', workerBaseUrl),
    queryFn: () => {
      requireApiBase(workerBaseUrl, ROBOTICS_SERVICE)
      return detectAruco(workerBaseUrl)
    },
    enabled: polled,
    refetchInterval: polled ? 1500 : false,
    retry: false,
  })
  const save = useMutation({
    mutationFn: () => {
      requireApiBase(workerBaseUrl, ROBOTICS_SERVICE)
      return calibrateAruco(workerBaseUrl)
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: roboticsKey('calibration-status', workerBaseUrl),
      }),
  })

  return {
    detecting,
    setDetecting,
    /** The latest detection, while detection is on. */
    result: detecting ? (detection.data ?? null) : null,
    isSaving: save.isPending,
    message: save.data?.message ?? null,
    error: save.error?.message ?? null,
    save: () => save.mutate(),
  }
}

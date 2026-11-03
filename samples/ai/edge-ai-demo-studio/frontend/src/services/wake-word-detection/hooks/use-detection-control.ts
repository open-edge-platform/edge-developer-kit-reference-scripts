// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { startDetection, stopDetection, wakeWordKey } from '../lib/api'

/** Starts listening; detections arrive over the worker's event stream, no webhook needed. */
export function useStartDetection(apiBase: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { deviceId?: number | null; threshold?: number }) =>
      startDetection(apiBase, params),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: wakeWordKey(apiBase, 'health'),
      }),
  })
}

export function useStopDetection(apiBase: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => stopDetection(apiBase),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: wakeWordKey(apiBase, 'health'),
      }),
  })
}

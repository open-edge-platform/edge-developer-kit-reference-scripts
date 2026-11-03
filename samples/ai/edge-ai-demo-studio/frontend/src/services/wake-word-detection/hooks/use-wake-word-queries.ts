// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useQuery } from '@tanstack/react-query'
import {
  fetchAudioDevices,
  fetchHealth,
  fetchModels,
  fetchSubscribers,
  wakeWordKey,
} from '../lib/api'

interface QueryOptions {
  /** False pauses the query; it asks only once the instance is added. */
  enabled?: boolean
}

/** Whether the worker listens, and which models it has loaded; polled. */
export function useWakeWordHealth(
  apiBase: string | undefined,
  { enabled = true }: QueryOptions = {},
) {
  return useQuery({
    queryKey: wakeWordKey(apiBase, 'health'),
    enabled: enabled && Boolean(apiBase),
    refetchInterval: 10_000,
    queryFn: () => fetchHealth(apiBase),
  })
}

export function useWakeWordSubscribers(
  apiBase: string | undefined,
  { enabled = true }: QueryOptions = {},
) {
  return useQuery({
    queryKey: wakeWordKey(apiBase, 'subscribers'),
    enabled: enabled && Boolean(apiBase),
    queryFn: () => fetchSubscribers(apiBase),
  })
}

/** The running worker's host microphones; disabled, it still reads what another caller fetched. */
export function useWakeWordDevices(
  apiBase: string | undefined,
  { enabled = true }: QueryOptions = {},
) {
  return useQuery({
    queryKey: wakeWordKey(apiBase, 'devices'),
    enabled: enabled && Boolean(apiBase),
    queryFn: () => fetchAudioDevices(apiBase),
  })
}

export function useWakeWordModels(
  apiBase: string | undefined,
  { enabled = true }: QueryOptions = {},
) {
  return useQuery({
    queryKey: wakeWordKey(apiBase, 'models'),
    enabled: enabled && Boolean(apiBase),
    queryFn: () => fetchModels(apiBase),
  })
}

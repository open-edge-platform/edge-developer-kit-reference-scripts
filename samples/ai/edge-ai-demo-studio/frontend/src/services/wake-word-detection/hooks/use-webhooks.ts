// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  sendTestWebhook,
  subscribeWebhook,
  unsubscribeWebhook,
  wakeWordKey,
} from '../lib/api'

/** Adds a webhook the worker calls on each detection above its threshold. */
export function useSubscribeWebhook(apiBase: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { url: string; name?: string; threshold: number }) =>
      subscribeWebhook(apiBase, params),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: wakeWordKey(apiBase, 'subscribers'),
      }),
  })
}

export function useUnsubscribeWebhook(apiBase: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (url: string) => unsubscribeWebhook(apiBase, url),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: wakeWordKey(apiBase, 'subscribers'),
      }),
  })
}

/** Sends a test detection to every subscriber; resolves with each outcome. */
export function useTestWebhooks(apiBase: string | undefined) {
  return useMutation({
    mutationFn: () => sendTestWebhook(apiBase),
  })
}

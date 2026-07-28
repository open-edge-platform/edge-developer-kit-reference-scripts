// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

interface StartupTimeoutResponse {
  startupTimeout: number
}

interface HfTokenResponse {
  hasToken: boolean
}

export function useHfToken() {
  return useQuery({
    queryKey: ['settings', 'hf-token'],
    queryFn: async (): Promise<HfTokenResponse> => {
      const response = await fetch('/api/settings/hf-token')
      if (!response.ok) throw new Error(await response.text())
      return response.json()
    },
  })
}

export function useStartupTimeout() {
  return useQuery({
    queryKey: ['startup-timeout'],
    queryFn: async (): Promise<StartupTimeoutResponse> => {
      const response = await fetch('/api/settings/startup-timeout')
      if (!response.ok) throw new Error(await response.text())
      return response.json()
    },
  })
}

export function useSaveHfToken(onSuccess: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (hfToken: string) => {
      const response = await fetch('/api/settings/hf-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hfToken }),
      })
      if (!response.ok) throw new Error(await response.text())
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'hf-token'] })
      onSuccess()
    },
  })
}

export function useSaveStartupTimeout(onSuccess: () => void) {
  return useMutation({
    mutationFn: async (startupTimeout: number) => {
      const response = await fetch('/api/settings/startup-timeout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startupTimeout }),
      })
      if (!response.ok) throw new Error(await response.text())
      return response
    },
    onSuccess,
  })
}

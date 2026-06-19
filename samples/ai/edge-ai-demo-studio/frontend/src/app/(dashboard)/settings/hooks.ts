// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMutation, useQuery } from '@tanstack/react-query'

interface StartupTimeoutResponse {
  startupTimeout: number
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
    onSuccess,
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

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query'

interface HfTokenResponse {
  hasToken: boolean
}

export function useHasHfToken(): boolean | undefined {
  const { data } = useQuery({
    queryKey: ['settings', 'hf-token'],
    queryFn: async (): Promise<HfTokenResponse> => {
      const res = await fetch('/api/settings/hf-token')
      if (!res.ok) throw new Error('Failed to fetch HF token status')
      return res.json() as Promise<HfTokenResponse>
    },
    staleTime: 30_000,
  })

  if (data === undefined) return undefined
  return data.hasToken
}

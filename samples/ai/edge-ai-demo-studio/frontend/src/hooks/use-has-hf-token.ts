// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/browser/fetch-json'

export interface HfTokenResponse {
  hasToken: boolean
}

export const HF_TOKEN_QUERY_KEY = ['settings', 'hf-token'] as const

/** Refetched on every window focus: the token is often added in Settings in another tab. */
export function useHfTokenQuery() {
  return useQuery({
    queryKey: HF_TOKEN_QUERY_KEY,
    queryFn: () =>
      fetchJson<HfTokenResponse>('/api/settings/hf-token', {
        errorMessage: 'Failed to fetch HF token status',
      }),
    staleTime: 30_000,
    refetchOnWindowFocus: 'always',
  })
}

export function useHasHfToken(): boolean | undefined {
  const { data } = useHfTokenQuery()
  if (data === undefined) return undefined
  return data.hasToken
}

/** Whether a Hugging Face token is set; a failed check is `unknown`, never "missing". */
export type HfTokenState = 'set' | 'missing' | 'checking' | 'unknown'

export function useHfTokenState(): HfTokenState {
  const { data, isError } = useHfTokenQuery()
  if (data !== undefined) return data.hasToken ? 'set' : 'missing'
  return isError ? 'unknown' : 'checking'
}

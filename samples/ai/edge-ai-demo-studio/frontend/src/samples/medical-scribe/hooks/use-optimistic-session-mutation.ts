// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { QueryKey } from '@tanstack/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'

interface UseOptimisticSessionMutationOptions<TItem, TVars, TResult> {
  queryKey: QueryKey
  mutationFn: (vars: TVars) => Promise<TResult>
  /** Applied to the cached list immediately, before the request settles. */
  patch: (prev: TItem[], vars: TVars) => TItem[]
  /** Reconciles the cache with the server response once the request succeeds. */
  onSuccess?: (data: TResult, vars: TVars, prev: TItem[]) => TItem[]
}

/** Optimistic list mutation: patches the cached array at once; on failure rolls back and refetches. */
export function useOptimisticSessionMutation<TItem, TVars, TResult>({
  queryKey,
  mutationFn,
  patch,
  onSuccess,
}: UseOptimisticSessionMutationOptions<TItem, TVars, TResult>) {
  const queryClient = useQueryClient()

  return useMutation<TResult, Error, TVars, { previous: TItem[] }>({
    mutationFn,
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<TItem[]>(queryKey) ?? []
      queryClient.setQueryData<TItem[]>(queryKey, patch(previous, vars))
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context) queryClient.setQueryData(queryKey, context.previous)
      queryClient.invalidateQueries({ queryKey })
    },
    onSuccess: (data, vars) => {
      if (!onSuccess) return
      const current = queryClient.getQueryData<TItem[]>(queryKey) ?? []
      queryClient.setQueryData<TItem[]>(
        queryKey,
        onSuccess(data, vars, current),
      )
    },
  })
}

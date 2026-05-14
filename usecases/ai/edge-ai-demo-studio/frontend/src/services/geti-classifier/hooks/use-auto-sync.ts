// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, type UseMutationOptions } from '@tanstack/react-query'

export interface AutoSyncResult {
  enabled: boolean
  message: string
}

async function toggleAutoSync(enabled: boolean): Promise<AutoSyncResult> {
  const res = await fetch('/api/geti-classifier/auto-sync/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })

  const data = (await res.json()) as AutoSyncResult & { error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Toggle failed')
  return data
}

export function useAutoSync(
  options?: UseMutationOptions<AutoSyncResult, Error, boolean>,
) {
  return useMutation<AutoSyncResult, Error, boolean>({
    mutationFn: toggleAutoSync,
    ...options,
  })
}

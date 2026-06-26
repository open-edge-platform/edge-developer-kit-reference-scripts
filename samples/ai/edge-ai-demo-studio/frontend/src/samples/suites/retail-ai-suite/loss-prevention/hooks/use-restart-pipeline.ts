// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

async function restartPipeline(): Promise<void> {
  const res = await fetch('/api/services/loss-prevention/restart-pipeline', {
    method: 'POST',
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(
      (data as { error?: string }).error ?? 'Failed to restart pipeline',
    )
  }
}

export function useRestartPipeline() {
  return useMutation({
    mutationFn: restartPipeline,
    onSuccess: () => {
      toast.success('Pipeline restarted — display window should reappear')
    },
    onError: (error: Error) => {
      toast.error('Failed to restart pipeline', {
        description: error.message,
      })
    },
  })
}

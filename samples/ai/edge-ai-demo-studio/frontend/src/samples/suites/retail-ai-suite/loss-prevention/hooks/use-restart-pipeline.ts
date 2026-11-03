// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { fetchOk } from '@/lib/browser/fetch-json'
import { toastError } from '@/lib/browser/toast-error'

async function restartPipeline(): Promise<void> {
  await fetchOk('/api/services/loss-prevention/restart-pipeline', {
    method: 'POST',
    errorMessage: 'Failed to restart pipeline',
  })
}

export function useRestartPipeline() {
  return useMutation({
    mutationFn: restartPipeline,
    onSuccess: () => {
      toast.success('Pipeline restarted — display window should reappear')
    },
    onError: toastError('Failed to restart pipeline'),
  })
}

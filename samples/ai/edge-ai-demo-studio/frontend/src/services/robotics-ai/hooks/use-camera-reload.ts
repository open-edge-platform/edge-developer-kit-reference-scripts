// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'

export function useCameraReloadMutation() {
  return useMutation({
    mutationFn: async ({
      workerBaseUrl,
    }: {
      workerBaseUrl: string
    }): Promise<void> => {
      const response = await fetch(`${workerBaseUrl}/camera/reload`, {
        method: 'POST',
      })
      if (!response.ok)
        throw new Error(`Camera reload failed: ${response.status}`)
      await response.json().catch(() => ({}))
    },
  })
}

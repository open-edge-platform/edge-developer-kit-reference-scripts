// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'

interface McpConnectResponse {
  message?: string
  tools?: unknown
}

export function useMcpConnectMutation() {
  return useMutation({
    mutationFn: async ({
      workerBaseUrl,
    }: {
      workerBaseUrl: string
    }): Promise<McpConnectResponse> => {
      const response = await fetch(`${workerBaseUrl}/api/mcp/connect`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error(`Failed with status ${response.status}`)
      return response.json().catch(() => ({}))
    },
  })
}

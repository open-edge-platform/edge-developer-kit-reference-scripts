// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query'

interface IsModelDownloadedResponse {
  downloaded: boolean
}

export function useIsModelDownloaded(
  serviceId: number | undefined,
  enabled = true,
): boolean | undefined {
  const { data } = useQuery({
    queryKey: ['services', serviceId, 'models', 'downloaded'],
    queryFn: async (): Promise<IsModelDownloadedResponse> => {
      const res = await fetch(`/api/services/${serviceId}/models`)
      if (!res.ok) throw new Error('Failed to check model download status')
      return res.json() as Promise<IsModelDownloadedResponse>
    },
    enabled: enabled && serviceId !== undefined,
    staleTime: 10_000,
    refetchInterval: 10_000,
  })

  if (data === undefined) return undefined
  return data.downloaded
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query'

const ALLOWED_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'

export interface TranslationJob {
  job_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  message: string
  created_at: string
  completed_at?: string
  output_file?: string
  error?: string
}

async function fetchTranslationStatus(jobId: string): Promise<TranslationJob> {
  if (!jobId || typeof jobId !== 'string') {
    throw new Error('Invalid job ID: must be a non-empty string')
  }
  if (jobId.length > 128) {
    throw new Error('Invalid job ID: exceeds maximum length')
  }

  let safeJobId = ''
  for (let i = 0; i < jobId.length; i++) {
    const idx = ALLOWED_CHARS.indexOf(jobId[i])
    if (idx === -1) {
      throw new Error('Invalid job ID: contains disallowed characters')
    }
    safeJobId += ALLOWED_CHARS[idx]
  }

  const response = await fetch(`/api/ppt-translator/status/${safeJobId}`)
  if (!response.ok) {
    throw new Error('Failed to fetch translation status')
  }
  return response.json() as Promise<TranslationJob>
}

export function useTranslationStatus(jobId: string | null) {
  return useQuery<TranslationJob, Error>({
    queryKey: ['ppt-translator', 'status', jobId],
    queryFn: () => fetchTranslationStatus(jobId!),
    enabled: jobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'completed' || status === 'failed') return false
      return 2000
    },
    staleTime: 0,
  })
}

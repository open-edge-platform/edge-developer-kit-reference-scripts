// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMutation } from '@tanstack/react-query'
import { requireApiBase } from '@/lib/browser/api-base'
import { postJson } from '@/lib/browser/fetch-json'
import type { SendResultConfig } from '../components/send-result-setup'

export type SendResultRecipient = {
  recipient: string
  success: boolean
  to?: string
  error?: string | null
}

export type SendResultStudentOutcome = {
  student_id: string
  student_name: string
  subject: string
  success: boolean
  sent: number
  failed: number
  recipients: SendResultRecipient[]
}

export type SendResultsResponse = {
  success: boolean
  platform?: string
  total_sent?: number
  total_failed?: number
  students_processed?: number
  summary?: string
  error?: string
  results?: SendResultStudentOutcome[]
}

export type ResultSelection = {
  studentId: string
  subject: string
}

/** Bulk-dispatch student results, resolving contact info from the contact sheet. */
export function useSendResults(apiBase: string | undefined) {
  return useMutation({
    mutationFn: (
      config: SendResultConfig & {
        dryRun?: boolean
        selections?: ResultSelection[]
      },
    ): Promise<SendResultsResponse> => {
      requireApiBase(apiBase, 'Exam Marking Agent')
      return postJson<SendResultsResponse>(
        `${apiBase}/v1/dispatch/send-results`,
        {
          recipientRole: config.recipientRole,
          subjectFilter: config.subjectFilter,
          platform: config.platform,
          dryRun: config.dryRun ?? false,
          manualTarget:
            config.recipientRole === 'teacher'
              ? config.manualTarget.trim() || undefined
              : undefined,
          selections: config.selections?.length ? config.selections : undefined,
        },
        { errorMessage: 'Failed to send results' },
      )
    },
  })
}

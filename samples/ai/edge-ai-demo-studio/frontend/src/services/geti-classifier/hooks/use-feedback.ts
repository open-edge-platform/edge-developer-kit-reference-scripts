// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, type UseMutationOptions } from '@tanstack/react-query'

export interface FeedbackPayload {
  host: string
  token: string
  imageId: string
  labelName: string
  isCorrect: boolean
  verifySsl?: boolean
}

export interface FeedbackResult {
  status: string
  action: string
  geti_image_id: string
  training_triggered: boolean
  training_tasks: string[]
}

async function submitFeedback(
  payload: FeedbackPayload,
): Promise<FeedbackResult> {
  const res = await fetch('/api/geti-classifier/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host: payload.host,
      token: payload.token,
      image_id: payload.imageId,
      label_name: payload.labelName,
      is_correct: payload.isCorrect,
      verify_ssl: payload.verifySsl ?? false,
    }),
  })

  const data = (await res.json()) as FeedbackResult & { error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Feedback submission failed')
  return data
}

export function useFeedback(
  options?: UseMutationOptions<FeedbackResult, Error, FeedbackPayload>,
) {
  return useMutation<FeedbackResult, Error, FeedbackPayload>({
    mutationFn: submitFeedback,
    ...options,
  })
}

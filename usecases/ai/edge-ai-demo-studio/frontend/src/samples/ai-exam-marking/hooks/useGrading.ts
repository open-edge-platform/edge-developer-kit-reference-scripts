// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'

export type GradingResult = {
  student_answer: string
  feedback: string
  marks_awarded: number
  human_review: boolean
}

export function useGrading() {
  return useMutation({
    mutationFn: async ({
      prompt,
      answer,
    }: {
      prompt: string
      answer: string
    }) => {
      const res = await fetch('/api/ai-exam-marking/grading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, answer }),
      })
      if (!res.ok) {
        throw new Error('Failed to fetch grading results')
      }
      return res.json() as Promise<GradingResult>
    },
  })
}

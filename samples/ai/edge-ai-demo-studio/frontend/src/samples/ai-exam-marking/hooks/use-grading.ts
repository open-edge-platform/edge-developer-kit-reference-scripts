// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'
import { useSampleInstancesBody } from '@/context/sample-instances-context'
import { postJson } from '@/lib/browser/fetch-json'

export type GradingResult = {
  student_answer: string
  feedback: string
  marks_awarded: number
  human_review: boolean
}

export function useGrading() {
  // The Text Generation instance this sample binds, for the grading route.
  const sampleInstances = useSampleInstancesBody()
  return useMutation({
    mutationFn: ({ prompt, answer }: { prompt: string; answer: string }) =>
      postJson<GradingResult>(
        '/api/ai-exam-marking/grading',
        { prompt, answer, ...sampleInstances },
        { errorMessage: 'Failed to fetch grading results' },
      ),
  })
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'
import { useSampleInstancesBody } from '@/context/sample-instances-context'
import { postJson } from '@/lib/browser/fetch-json'

export function useOCR() {
  // The Text Generation instance this sample binds, for the OCR route.
  const sampleInstances = useSampleInstancesBody()
  return useMutation({
    mutationFn: ({ image, prompt }: { image: string; prompt: string }) =>
      postJson<Record<string, unknown>>(
        '/api/ai-exam-marking/ocr',
        { image, prompt, ...sampleInstances },
        { errorMessage: 'Failed to fetch OCR results' },
      ),
  })
}

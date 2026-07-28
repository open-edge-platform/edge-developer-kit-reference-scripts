// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'

export function useOCR() {
  return useMutation({
    mutationFn: async ({
      image,
      prompt,
    }: {
      image: string
      prompt: string
    }) => {
      const res = await fetch('/api/ai-exam-marking/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, prompt }),
      })
      if (!res.ok) {
        throw new Error('Failed to fetch OCR results')
      }
      return res.json() as Promise<Record<string, unknown>>
    },
  })
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'

interface TranscribeVariables {
  url: string
  blob: Blob
  fileName: string
  language: string
}

interface TranscribeResponse {
  text?: string
}

export function useTranscribeMutation() {
  return useMutation({
    mutationFn: async ({
      url,
      blob,
      fileName,
      language,
    }: TranscribeVariables): Promise<TranscribeResponse> => {
      const form = new FormData()
      form.append('file', blob, fileName)
      form.append('language', language)
      const res = await fetch(url, { method: 'POST', body: form })
      if (!res.ok) throw new Error(`STT request failed: ${res.status}`)
      return res.json().catch(() => ({}))
    },
  })
}

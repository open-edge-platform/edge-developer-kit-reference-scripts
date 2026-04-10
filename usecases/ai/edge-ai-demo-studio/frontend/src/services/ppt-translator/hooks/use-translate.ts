// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, type UseMutationOptions } from '@tanstack/react-query'
import type { PptTranslatorParamValues } from './use-params'

export interface TranslatePayload {
  file: File
  params: PptTranslatorParamValues
}

export interface TranslateResult {
  job_id: string
  status: string
  message: string
}

async function submitTranslation(
  payload: TranslatePayload,
): Promise<TranslateResult> {
  const { file, params } = payload

  const formData = new FormData()
  formData.append('file', file)
  formData.append('source_language', params.sourceLanguage)
  formData.append('target_language', params.targetLanguage)
  formData.append('preserve_proper_nouns', String(params.preserveProperNouns))
  formData.append(
    'translate_speaker_notes',
    String(params.translateSpeakerNotes),
  )
  formData.append('auto_adjust_font_size', String(params.autoAdjustFontSize))
  formData.append('presentation_context', params.presentationContext)
  formData.append('model', params.model)

  const response = await fetch('/api/ppt-translator/translate', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    let errorMessage = 'Upload failed'

    try {
      const errorData = (await response.json()) as Record<string, unknown>

      if (typeof errorData?.error === 'string') {
        errorMessage = errorData.error
      } else if (typeof errorData?.detail === 'string') {
        errorMessage = errorData.detail
      } else if (errorData?.detail && typeof errorData.detail === 'object') {
        const detail = errorData.detail as Record<string, unknown>
        errorMessage =
          (typeof detail.message === 'string' && detail.message) ||
          (typeof detail.error === 'string' && detail.error) ||
          JSON.stringify(detail)
      }
    } catch {
      try {
        const text = await response.text()
        if (text) errorMessage = text
      } catch {}
    }

    throw new Error(errorMessage)
  }

  return response.json() as Promise<TranslateResult>
}

export function useTranslate(
  options?: UseMutationOptions<TranslateResult, Error, TranslatePayload>,
) {
  return useMutation<TranslateResult, Error, TranslatePayload>({
    mutationFn: submitTranslation,
    ...options,
  })
}

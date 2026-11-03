// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'
import { requireApiBase } from '@/lib/browser/api-base'
import { fetchWork } from '@/services/common/metrics/work'

export interface TranscribeSegment {
  start: number
  end: number
  text: string
}

interface UpstreamSegment {
  start?: number
  end?: number
  text?: string
}

/**
 * Batch transcription via `POST /v1/audio/transcriptions`. Always asks for `verbose_json`, whose
 * `duration` the Live metrics compare against real time. `useDenoise` only works on OVMS.
 */
export function useTranscribe(apiBase: string | undefined) {
  return useMutation({
    mutationFn: async ({
      file,
      language,
      returnTimestamps,
      useDenoise,
    }: {
      file: Blob
      language: string
      returnTimestamps?: boolean
      useDenoise?: boolean
    }) => {
      requireApiBase(apiBase, 'Speech to Text')
      const formData = new FormData()
      const filename = file instanceof File ? file.name : 'recording.webm'
      formData.append('file', file, filename)
      formData.append('model', 'whisper-1')
      formData.append('language', language)
      formData.append('response_format', 'verbose_json')
      if (useDenoise) {
        formData.append('use_denoise', 'true')
      }

      const data = await fetchWork<{
        text?: string
        duration?: number
        segments?: UpstreamSegment[]
      }>(
        apiBase,
        '/v1/audio/transcriptions',
        {
          method: 'POST',
          body: formData,
          errorMessage: 'Transcription failed',
        },
        (body) => ({ audioSeconds: Number(body.duration) }),
      )
      const result: {
        text: string
        status: boolean
        segments?: TranscribeSegment[]
      } = { text: (data.text ?? '').trim(), status: true }
      if (returnTimestamps) {
        result.segments = (data.segments ?? []).map((s) => ({
          start: Number(s.start ?? 0),
          end: Number(s.end ?? 0),
          text: (s.text ?? '').trim(),
        }))
      }
      return result
    },
  })
}

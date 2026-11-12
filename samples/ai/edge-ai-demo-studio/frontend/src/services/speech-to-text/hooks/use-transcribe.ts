// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'
import { requireApiBase } from '@/lib/browser/api-base'
import { fetchWork } from '@/services/common/metrics/work'
import type { TimedText } from '../lib/transcript-export'

interface UpstreamSegment {
  start?: number
  end?: number
  text?: string
}

interface UpstreamWord {
  start?: number
  end?: number
  word?: string
}

/**
 * Batch transcription via `POST /v1/audio/transcriptions`. Always asks for `verbose_json`, whose
 * `duration` the Live metrics compare against real time, and whose `segments` are always mapped.
 * `useDenoise` only works on OVMS. `returnWords` adds word timings (`words`, possibly empty)
 * alongside the segments; on OVMS, Qwen3-ASR's come from a forced aligner, which is why they are opt-in.
 */
export function useTranscribe(apiBase: string | undefined) {
  return useMutation({
    mutationFn: async ({
      file,
      language,
      returnWords,
      useDenoise,
    }: {
      file: Blob
      language: string
      returnWords?: boolean
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
      if (returnWords) {
        // Naming any granularity drops the default segments, so ask for both.
        formData.append('timestamp_granularities[]', 'word')
        formData.append('timestamp_granularities[]', 'segment')
      }

      const data = await fetchWork<{
        text?: string
        duration?: number
        segments?: UpstreamSegment[]
        words?: UpstreamWord[]
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
        segments?: TimedText[]
        words?: TimedText[]
      } = { text: (data.text ?? '').trim(), status: true }
      result.segments = (data.segments ?? []).map((s) => ({
        start: Number(s.start ?? 0),
        end: Number(s.end ?? 0),
        text: (s.text ?? '').trim(),
      }))
      if (returnWords) {
        result.words = (data.words ?? []).map((w) => ({
          start: Number(w.start ?? 0),
          end: Number(w.end ?? 0),
          text: (w.word ?? '').trim(),
        }))
      }
      return result
    },
  })
}

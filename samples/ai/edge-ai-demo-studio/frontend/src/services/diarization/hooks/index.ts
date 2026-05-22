// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'

export { useDiarizationParams, DIARIZATION_DEFAULTS } from './use-params'
export type { DiarizationParamValues } from './use-params'

export interface SpeakerProfile {
  label: string
  embedding: number[]
}

interface DiarizeInput {
  file: Blob
  /** Multi-speaker profiles (preferred) */
  speakerProfiles?: SpeakerProfile[]
  /** Legacy single-reference fields */
  referenceEmbedding?: number[]
  referenceLabel?: string
  otherLabel?: string
  unknownLabel?: string
  numSpeakers?: number
  speakerMatchThreshold?: number
}

interface DiarizeSegment {
  speaker: string
  start: number
  end: number
}

interface DiarizeResponse {
  segments: DiarizeSegment[]
}

interface DiarizeJobResponse {
  job_id: string
}

interface DiarizeJobStatus {
  status: 'pending' | 'completed' | 'error'
  result?: DiarizeResponse
  error?: string
}

interface EmbeddingResponse {
  embedding: number[]
}

async function parseErrorResponse(
  res: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = await res.json()
    if (typeof body.detail === 'string') return body.detail
  } catch {
    /* not JSON — fall through */
  }
  return fallback
}

export function useEnrollSpeaker() {
  return useMutation({
    mutationFn: async (file: Blob): Promise<EmbeddingResponse> => {
      const formData = new FormData()
      const filename = file instanceof File ? file.name : 'reference.webm'
      formData.append('file', file, filename)

      const res = await fetch('/api/diarization/v1/embedding', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        throw new Error(
          await parseErrorResponse(res, 'Speaker enrollment failed'),
        )
      }
      return res.json() as Promise<EmbeddingResponse>
    },
  })
}

const POLL_INTERVAL_MS = 5_000

function pollJobStatus(jobId: string): Promise<DiarizeResponse> {
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const url = new URL(
          `/api/diarization/v1/diarize/${jobId}`,
          window.location.origin,
        )
        const res = await fetch(url)
        if (!res.ok) {
          reject(
            new Error(
              await parseErrorResponse(res, 'Failed to check job status'),
            ),
          )
          return
        }
        const data = (await res.json()) as DiarizeJobStatus
        if (data.status === 'completed' && data.result) {
          resolve(data.result)
          return
        }
        if (data.status === 'error') {
          reject(new Error(data.error ?? 'Diarization failed'))
          return
        }
        // Still pending — schedule next poll
        setTimeout(poll, POLL_INTERVAL_MS)
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    }
    poll()
  })
}

export function useDiarize() {
  return useMutation({
    mutationFn: async (input: DiarizeInput): Promise<DiarizeResponse> => {
      const formData = new FormData()
      const filename =
        input.file instanceof File ? input.file.name : 'audio.webm'
      formData.append('file', input.file, filename)

      if (input.speakerProfiles && input.speakerProfiles.length > 0) {
        formData.append(
          'speaker_profiles',
          JSON.stringify(input.speakerProfiles),
        )
        if (input.unknownLabel) {
          formData.append('unknown_label', input.unknownLabel)
        }
      } else if (input.referenceEmbedding) {
        formData.append(
          'reference_embedding',
          JSON.stringify(input.referenceEmbedding),
        )
        if (input.referenceLabel) {
          formData.append('reference_label', input.referenceLabel)
        }
        if (input.otherLabel) {
          formData.append('other_label', input.otherLabel)
        }
      }
      if (input.numSpeakers !== undefined) {
        formData.append('num_speakers', String(input.numSpeakers))
      }
      if (input.speakerMatchThreshold !== undefined) {
        formData.append(
          'speaker_match_threshold',
          String(input.speakerMatchThreshold),
        )
      }

      const res = await fetch('/api/diarization/v1/diarize', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        throw new Error(await parseErrorResponse(res, 'Diarization failed'))
      }
      const { job_id: jobId } = (await res.json()) as DiarizeJobResponse
      return pollJobStatus(jobId)
    },
  })
}

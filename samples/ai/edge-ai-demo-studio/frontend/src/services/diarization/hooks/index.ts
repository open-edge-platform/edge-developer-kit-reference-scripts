// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { requireApiBase } from '@/lib/browser/api-base'
import { fetchJson } from '@/lib/browser/fetch-json'
import { CANCELLED } from '@/lib/browser/sse'
import { demoStateKey } from '@/services/common/demo/demo-session'
import {
  type JobDefinition,
  JobRun,
  jobFailure,
} from '@/services/common/jobs/job-run'
import { useJobRun } from '@/services/common/jobs/use-job-run'
import type { Service } from '@/services/types'

export { useDiarizationParams, DIARIZATION_DEFAULTS } from './use-params'

export interface SpeakerProfile {
  label: string
  embedding: number[]
}

/** What to diarize, and how to name the speakers found. */
export interface DiarizeRequest {
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

export interface DiarizeSegment {
  speaker: string
  start: number
  end: number
}

export interface DiarizeResponse {
  segments: DiarizeSegment[]
}

/** `queued` while the job waits for the pipeline, then the pipeline stage it is in. */
export type DiarizeStage =
  | 'queued'
  | 'decoding'
  | 'segmentation'
  | 'embeddings'
  | 'clustering'
  | 'matching'

export interface DiarizeJobStatus {
  /** `pending` waits for the pipeline, which runs one job at a time. */
  status: 'pending' | 'running' | 'completed' | 'error' | typeof CANCELLED
  stage?: DiarizeStage
  /** 0–1 over the whole job. */
  progress?: number
  /** While pending: the jobs still to start, this one included. */
  position?: number
  /** While running: a cancel was asked for; it stops at the next step. */
  cancel_requested?: boolean
  result?: DiarizeResponse
  error?: string
  /** Once completed: the audio and the time it took, for Live metrics. */
  perf?: unknown
}

/** How a diarization call whose job was cancelled rejects. */
export class DiarizationCancelledError extends Error {
  constructor() {
    super('Diarization was cancelled')
    this.name = 'DiarizationCancelledError'
  }
}

function diarizeForm(request: DiarizeRequest): FormData {
  const formData = new FormData()
  const filename =
    request.file instanceof File ? request.file.name : 'audio.webm'
  formData.append('file', request.file, filename)

  if (request.speakerProfiles && request.speakerProfiles.length > 0) {
    formData.append('speaker_profiles', JSON.stringify(request.speakerProfiles))
    if (request.unknownLabel) {
      formData.append('unknown_label', request.unknownLabel)
    }
  } else if (request.referenceEmbedding) {
    formData.append(
      'reference_embedding',
      JSON.stringify(request.referenceEmbedding),
    )
    if (request.referenceLabel) {
      formData.append('reference_label', request.referenceLabel)
    }
    if (request.otherLabel) formData.append('other_label', request.otherLabel)
  }
  if (request.numSpeakers !== undefined) {
    formData.append('num_speakers', String(request.numSpeakers))
  }
  if (request.speakerMatchThreshold !== undefined) {
    formData.append(
      'speaker_match_threshold',
      String(request.speakerMatchThreshold),
    )
  }
  return formData
}

/** Diarizing a recording as a background job of the worker. */
function diarizeJob(
  apiBase: string | undefined,
): JobDefinition<DiarizeRequest, DiarizeJobStatus, DiarizeResponse> {
  return {
    submit: async (request, signal) => {
      requireApiBase(apiBase, 'Diarization')
      const { job_id: jobId } = await fetchJson<{ job_id: string }>(
        `${apiBase}/v1/diarize`,
        {
          method: 'POST',
          body: diarizeForm(request),
          signal,
          errorMessage: 'Diarization failed',
        },
      )
      return jobId
    },
    jobUrl: (jobId) => `${apiBase}/v1/diarize/${encodeURIComponent(jobId)}`,
    toResult: (status) => {
      if (status.status === 'error' || !status.result) {
        throw jobFailure(status, 'Diarization failed')
      }
      return status.result
    },
    metricsApiBase: apiBase,
    followErrorMessage: 'Failed to check job status',
  }
}

/** The demo's diarization job, kept per instance for the page visit; leaving the page cancels it. */
export function useDiarizationJob(service: Service) {
  return useJobRun(diarizeJob(service.apiBase), {
    sessionKey: demoStateKey(service, 'diarization:job'),
  })
}

/**
 * Diarization calls that run side by side, each its own job. Aborting a call's `signal`, or
 * unmounting, cancels its job and rejects the call with `DiarizationCancelledError`.
 */
export function useDiarize(apiBase: string | undefined) {
  const runsRef = useRef(
    new Set<JobRun<DiarizeRequest, DiarizeJobStatus, DiarizeResponse>>(),
  )

  useEffect(() => {
    const runs = runsRef.current
    return () => {
      for (const run of runs) run.abandon()
    }
  }, [])

  const mutateAsync = async ({
    signal,
    ...request
  }: DiarizeRequest & { signal?: AbortSignal }): Promise<DiarizeResponse> => {
    if (signal?.aborted) throw new DiarizationCancelledError()
    const run = new JobRun(diarizeJob(apiBase), request)
    const runs = runsRef.current
    runs.add(run)
    const abandon = () => run.abandon()
    signal?.addEventListener('abort', abandon)
    try {
      const settled = await run.done
      if (settled.phase === 'done' && settled.result) return settled.result
      if (settled.phase === 'cancelled') throw new DiarizationCancelledError()
      throw settled.error ?? new Error('Diarization failed')
    } finally {
      signal?.removeEventListener('abort', abandon)
      runs.delete(run)
    }
  }

  return { mutateAsync }
}

interface EmbeddingResponse {
  embedding: number[]
}

export function useEnrollSpeaker(apiBase: string | undefined) {
  return useMutation({
    mutationFn: (file: Blob): Promise<EmbeddingResponse> => {
      requireApiBase(apiBase, 'Diarization')
      const formData = new FormData()
      const filename = file instanceof File ? file.name : 'reference.webm'
      formData.append('file', file, filename)

      return fetchJson(`${apiBase}/v1/embedding`, {
        method: 'POST',
        body: formData,
        errorMessage: 'Speaker enrollment failed',
      })
    },
  })
}

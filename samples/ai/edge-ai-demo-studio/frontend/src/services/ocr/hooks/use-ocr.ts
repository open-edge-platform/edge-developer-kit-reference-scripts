// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query'
import { requireApiBase } from '@/lib/browser/api-base'
import { fetchJson } from '@/lib/browser/fetch-json'
import type { CANCELLED } from '@/lib/browser/sse'
import { type JobDefinition, jobFailure } from '@/services/common/jobs/job-run'
import { useJobRun } from '@/services/common/jobs/use-job-run'

// Types mirror the paddleocr worker's result.py.

/**
 * `box`: 4 [x, y] corners, clockwise from top-left, in source-image pixels; null when the model
 * returns text without geometry (e.g. the VL model in plain-OCR mode).
 */
export interface OcrRegion {
  text: string
  confidence: number
  box: [number, number][] | null
}

export interface OcrResult {
  model: string
  full_text: string
  regions: OcrRegion[]
  num_regions: number
  elapsed_ms: number
  extra: Record<string, unknown>
}

/** VL-only task selector; PP-OCR models ignore it. */
export type OcrTask = 'ocr' | 'table' | 'formula' | 'chart'

/** One selectable recognition language, as served by GET /languages. */
export interface OcrLanguage {
  key: string
  label: string
  description: string
  /** Recogniser generation ("PP-OCRv5" / "PP-OCRv3"), blank for the default. */
  generation: string
  /** True for the sentinel that keeps the model's built-in recogniser. */
  is_default: boolean
  rtl: boolean
}

export interface OcrLanguages {
  active: string
  /** False when the active model ignores it: VL models read the script off the page. */
  applies: boolean
  available: OcrLanguage[]
}

export interface OcrRequest {
  file: File
  /** VL models only. Defaults to "ocr". */
  task?: OcrTask
  /** Defaults to the worker's language. PP-OCR swaps its recogniser to match; VL ignores it. */
  lang?: string
  /** PP-OCR minimum confidence to keep a region. */
  dropScore?: number
  /** VL generation cap. */
  maxNewTokens?: number
}

/** `cancelled` follows `DELETE /ocr/jobs/{id}`. */
export type OcrJobState =
  'pending' | 'running' | 'done' | 'error' | typeof CANCELLED

/** Envelope returned by the async submit, poll and events endpoints. */
export interface OcrJobStatus {
  job_id: string
  status: OcrJobState
  result: OcrResult | null
  error: string | null
  /** Text so far: a VL model grows it as it generates; PP-OCR fills it in once, when done. */
  partial_text?: string
  /** Set once cancelled; a running job keeps its status until its pass stops. */
  cancel_requested?: boolean
  /** Once done: the image and the time it took, for Live metrics. */
  perf?: unknown
}

function buildQuery({
  task,
  lang,
  dropScore,
  maxNewTokens,
}: OcrRequest): string {
  const params = new URLSearchParams()
  if (task) params.set('task', task)
  if (lang) params.set('lang', lang)
  if (dropScore != null) params.set('drop_score', String(dropScore))
  if (maxNewTokens != null) params.set('max_new_tokens', String(maxNewTokens))
  const query = params.toString()
  return query ? `?${query}` : ''
}

function fileForm(file: File): FormData {
  const formData = new FormData()
  formData.append('file', file)
  return formData
}

/**
 * A background job, so a heavy VL pass holds no request open and its text shows as generated
 * (`partial_text`). No deadline: a VL pass on a CPU can run for minutes.
 */
function ocrJob(
  apiBase: string | undefined,
): JobDefinition<OcrRequest, OcrJobStatus, OcrResult> {
  return {
    submit: async (req, signal) => {
      requireApiBase(apiBase, 'OCR')
      const submitted = await fetchJson<OcrJobStatus>(
        `${apiBase}/ocr/jobs${buildQuery(req)}`,
        {
          method: 'POST',
          body: fileForm(req.file),
          signal,
          errorMessage: 'Failed to submit OCR job',
        },
      )
      return submitted.job_id
    },
    jobUrl: (jobId) => `${apiBase}/ocr/jobs/${encodeURIComponent(jobId)}`,
    toResult: (status) => {
      if (status.status === 'error' || status.result == null) {
        throw jobFailure(status, 'OCR job failed')
      }
      return status.result
    },
    metricsApiBase: apiBase,
    followErrorMessage: 'Failed to follow OCR job',
  }
}

/** Fetched, not hard-coded: the worker owns the catalogue, as it downloads each recogniser. */
export function useOcrLanguages(apiBase: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['ocr-languages', apiBase],
    queryFn: () => {
      requireApiBase(apiBase, 'OCR')
      return fetchJson<OcrLanguages>(`${apiBase}/languages`)
    },
    retry: false,
    enabled: enabled && Boolean(apiBase),
    staleTime: 60_000,
  })
}

/**
 * The job id lives only here, so a new image (`reset`) or unmounting cancels the job on the
 * worker, freeing the model for the next one.
 */
export function useOcrJob(apiBase: string | undefined) {
  return useJobRun(ocrJob(apiBase))
}

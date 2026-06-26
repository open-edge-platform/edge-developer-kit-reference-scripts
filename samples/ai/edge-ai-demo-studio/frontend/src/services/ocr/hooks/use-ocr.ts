// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, type UseMutationOptions } from '@tanstack/react-query'

// ── Types (mirror workers/ocr/paddleocr result.py) ──────────────────────────

/** One recognised text region. `box` is 4 [x, y] corner points (clockwise from
 *  top-left) in pixels of the source image, or null when a model returns text
 *  without geometry (e.g. the VL model in plain-OCR mode). */
export interface OcrRegion {
  text: string
  confidence: number
  box: [number, number][] | null
}

/** Full result of an OCR pass over a single image. */
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

export interface OcrRequest {
  file: File
  /** VL task (ocr|table|formula|chart). Defaults to "ocr". */
  task?: OcrTask
  /** PP-OCR minimum confidence to keep a region. */
  dropScore?: number
  /** VL generation cap. */
  maxNewTokens?: number
}

/** Lifecycle of an async OCR job (POST /ocr/jobs → GET /ocr/jobs/{id}). */
export type OcrJobState = 'pending' | 'running' | 'done' | 'error'

/** Envelope returned by the async submit + poll endpoints. */
export interface OcrJobStatus {
  job_id: string
  status: OcrJobState
  result: OcrResult | null
  error: string | null
}

// ── Request helpers ───────────────────────────────────────────────────────────

function buildQuery({ task, dropScore, maxNewTokens }: OcrRequest): string {
  const params = new URLSearchParams()
  if (task) params.set('task', task)
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

const sleep = (ms: number) =>
  new Promise((r) =>
    setTimeout(() => {
      r(1)
    }, ms),
  )

export async function runOcrSync(req: OcrRequest): Promise<OcrResult> {
  const url = new URL(`/api/ocr/ocr${buildQuery(req)}`, window.location.origin)
  const res = await fetch(url, {
    method: 'POST',
    body: fileForm(req.file),
  })

  const data = (await res.json()) as OcrResult & {
    detail?: string
    error?: string
  }

  if (!res.ok) {
    throw new Error(data.detail ?? data.error ?? 'OCR request failed')
  }

  return data
}

// ── Asynchronous fetcher (POST /ocr/jobs → poll GET /ocr/jobs/{id}) ────────────

const POLL_INTERVAL_MS = 400
const POLL_TIMEOUT_MS = 120_000

export async function runOcrAsync(req: OcrRequest): Promise<OcrResult> {
  const url = new URL(
    `/api/ocr/ocr/jobs${buildQuery(req)}`,
    window.location.origin,
  )
  const submitRes = await fetch(url, {
    method: 'POST',
    body: fileForm(req.file),
  })
  const submitData = (await submitRes.json()) as OcrJobStatus & {
    detail?: string
    error?: string
  }
  if (!submitRes.ok) {
    throw new Error(
      submitData.detail ?? submitData.error ?? 'Failed to submit OCR job',
    )
  }

  // 2. Poll until the job reaches a terminal state (or we give up).
  const jobId = submitData.job_id
  const deadline = Date.now() + POLL_TIMEOUT_MS
  for (;;) {
    const url = new URL(`/api/ocr/ocr/jobs/${jobId}`, window.location.origin)
    const pollRes = await fetch(url)
    const job = (await pollRes.json()) as OcrJobStatus & { detail?: string }
    if (!pollRes.ok) {
      throw new Error(job.detail ?? job.error ?? 'Failed to poll OCR job')
    }
    if (job.status === 'done' && job.result) {
      return job.result
    }
    if (job.status === 'error') {
      throw new Error(job.error ?? 'OCR job failed')
    }
    if (Date.now() > deadline) {
      throw new Error('OCR job timed out')
    }
    await sleep(POLL_INTERVAL_MS)
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

// Uses the async submit-and-poll API so heavy VL passes don't hold a request
// open. The worker also exposes a synchronous POST /ocr (see runOcrSync).
export function useOcr(
  options?: UseMutationOptions<OcrResult, Error, OcrRequest>,
) {
  return useMutation<OcrResult, Error, OcrRequest>({
    mutationFn: runOcrAsync,
    ...options,
  })
}

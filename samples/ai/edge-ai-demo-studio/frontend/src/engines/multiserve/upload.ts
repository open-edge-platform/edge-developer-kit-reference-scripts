// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { fetchJson } from '@/lib/browser/fetch-json'
import { safeUrl, URL_CHARS } from '@/lib/validation'
import type { BackendId } from './types'

/**
 * Chunked model upload to the engine's `POST /v1/model/upload/chunk` (contract:
 * `workers/engines/multiserve/routers/utils.py`). Models are often several GB: chunks give progress,
 * resend a dropped chunk instead of the whole file, and let a cancel stop between two chunks.
 */

/** Small enough for any proxy body limit, large enough that GBs take few requests. */
const UPLOAD_CHUNK_BYTES = 16 * 1024 * 1024

/** Tries per chunk; every chunk request is safe to repeat. */
const CHUNK_ATTEMPTS = 4
const RETRY_DELAYS_MS = [1_000, 3_000, 10_000]

interface UploadFileProgress {
  name: string
  sentBytes: number
  totalBytes: number
}

export interface UploadProgress {
  /** Bytes the engine has accepted, over every file. */
  sentBytes: number
  totalBytes: number
  files: UploadFileProgress[]
  /** Index into `files` of the file being sent. */
  currentFile: number
  /** Set while a failed chunk waits to be sent again. */
  retry?: { attempt: number; of: number }
}

export interface UploadModelParams {
  serviceId: string
  backend: BackendId
  repoId: string
  task: string
  files: File[]
  forceOverride?: boolean
  signal?: AbortSignal
  onProgress?: (progress: UploadProgress) => void
}

interface UploadModelResponse {
  message: string
  repo_id: string
  internal_path: string
  task: string
  completed: boolean
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Upload cancelled', 'AbortError')
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** A failure worth sending the same chunk again for. */
function isRetryable(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status
  // No status: no answer at all (connection dropped, proxy gave up).
  if (typeof status !== 'number') return true
  return status === 408 || status === 429 || status >= 500
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortReason(signal as AbortSignal))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function sendChunk(
  url: string,
  form: FormData,
  signal: AbortSignal | undefined,
  onRetry: (retry: { attempt: number; of: number }) => void,
): Promise<UploadModelResponse> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchJson<UploadModelResponse>(url, {
        method: 'POST',
        body: form,
        signal,
        errorMessage: 'Upload failed',
      })
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal)
      if (attempt >= CHUNK_ATTEMPTS || !isRetryable(error)) throw error
      onRetry({ attempt: attempt + 1, of: CHUNK_ATTEMPTS })
      await wait(RETRY_DELAYS_MS[attempt - 1] ?? 10_000, signal)
    }
  }
}

function newUploadId(): string {
  return crypto.randomUUID().replaceAll('-', '')
}

/**
 * Uploads `files` as one model; the engine moves it into place after the last file. Rejects with
 * the engine's message or an `AbortError`, dropping what the engine staged either way.
 */
export async function uploadModel({
  serviceId,
  backend,
  repoId,
  task,
  files,
  forceOverride,
  signal,
  onProgress,
}: UploadModelParams): Promise<UploadModelResponse> {
  if (files.length === 0) throw new Error('No file selected')

  const url = `/api/${serviceId}/v1/model/upload/chunk`
  const uploadId = newUploadId()
  const fields: Record<string, string> = {
    repo_id: `${backend}:${repoId}`,
    task,
    upload_id: uploadId,
    ...(forceOverride ? { force_override: 'true' } : {}),
  }

  const progressFiles = files.map((file) => ({
    name: file.name,
    sentBytes: 0,
    totalBytes: file.size,
  }))
  let sentBytes = 0
  let currentFile = 0
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  const report = (retry?: UploadProgress['retry']) =>
    onProgress?.({
      sentBytes,
      totalBytes,
      currentFile,
      files: progressFiles.map((file) => ({ ...file })),
      ...(retry ? { retry } : {}),
    })
  report()

  let last: UploadModelResponse | undefined
  try {
    for (const [fileIndex, file] of files.entries()) {
      currentFile = fileIndex
      const totalChunks = Math.max(1, Math.ceil(file.size / UPLOAD_CHUNK_BYTES))
      const isLastFile = fileIndex === files.length - 1
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        if (signal?.aborted) throw abortReason(signal)
        const start = chunkIndex * UPLOAD_CHUNK_BYTES
        const chunk = file.slice(start, start + UPLOAD_CHUNK_BYTES)

        const form = new FormData()
        for (const [key, value] of Object.entries(fields)) {
          form.append(key, value)
        }
        form.append('relative_path', file.webkitRelativePath || file.name)
        form.append('chunk_index', String(chunkIndex))
        form.append('total_chunks', String(totalChunks))
        form.append('total_size', String(file.size))
        form.append('commit', isLastFile ? 'true' : 'false')
        form.append('file', chunk, file.name)

        last = await sendChunk(url, form, signal, report)
        progressFiles[fileIndex].sentBytes += chunk.size
        sentBytes += chunk.size
        report()
      }
    }
  } catch (error) {
    discardUpload(url, fields, files[0].name)
    throw error
  }

  if (!last?.completed) {
    discardUpload(url, fields, files[0].name)
    throw new Error('The engine did not confirm the model was assembled')
  }
  return last
}

/** Best effort: the engine also drops an abandoned upload after a day. */
function discardUpload(
  url: string,
  fields: Record<string, string>,
  filename: string,
): void {
  const form = new FormData()
  form.append('repo_id', fields.repo_id)
  form.append('task', fields.task)
  form.append('upload_id', fields.upload_id)
  form.append('filename', filename)
  // Throwing here would hide the failed upload's error. A URL with a character outside the
  // allow-list is not requested at all (fail closed).
  let target = ''
  for (const ch of safeUrl(url)) {
    let ok = ''
    for (const allowed of URL_CHARS)
      if (allowed === ch) {
        ok = allowed
        break
      }
    if (!ok) {
      target = ''
      break
    }
    target += ok
  }
  if (target) fetch(target, { method: 'DELETE', body: form }).catch(() => {})
}

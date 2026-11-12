// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMutation } from '@tanstack/react-query'
import { requireApiBase } from '@/lib/browser/api-base'
import { fetchOk, isHttpError, postJson } from '@/lib/browser/fetch-json'
import type { ArchiveRequest } from '@/samples/ai-exam-marking/lib/types'

const SERVICE_NAME = 'Exam Marking Agent'

/** Returns true when the paper was moved and its annotated result stored. */
async function moveToMarked(
  apiBase: string,
  req: ArchiveRequest & { sourceFilename: string },
): Promise<boolean> {
  try {
    const data = await postJson<{ annotatedDestination?: string | null }>(
      `${apiBase}/v1/move-to-marked`,
      {
        filename: req.sourceFilename,
        annotatedImage: req.annotatedImage,
        annotatedFilename: req.annotatedFilename,
        studentId: req.studentId,
        subject: req.subject,
      },
      { errorMessage: 'Archiving paper failed' },
    )
    return Boolean(data.annotatedDestination)
  } catch (error) {
    // 404 means an earlier attempt already moved the paper out of prior_mark.
    if (isHttpError(error, 404)) return false
    throw error
  }
}

async function storeAnnotatedResult(
  apiBase: string,
  req: ArchiveRequest,
): Promise<void> {
  await postJson<unknown>(
    `${apiBase}/v1/store-annotated-result`,
    {
      originalFilename: req.originalFilename,
      annotatedImage: req.annotatedImage,
      annotatedFilename: req.annotatedFilename,
      studentId: req.studentId,
      subject: req.subject,
    },
    { errorMessage: 'Storing annotated result failed' },
  )
}

/** Archive a graded paper; rejects unless the annotated result was stored. */
export function useArchiveResult(apiBase: string | undefined) {
  return useMutation({
    mutationFn: async (req: ArchiveRequest) => {
      requireApiBase(apiBase, SERVICE_NAME)
      if (
        req.sourceFilename &&
        (await moveToMarked(apiBase, {
          ...req,
          sourceFilename: req.sourceFilename,
        }))
      )
        return
      await storeAnnotatedResult(apiBase, req)
    },
  })
}

/** Unlock a prior_mark paper so the agent's watcher may send it again; best effort. */
export function releaseInflightSource(
  apiBase: string | undefined,
  filename: string | undefined,
): void {
  if (!apiBase || !filename) return
  fetchOk(`${apiBase}/v1/release-inflight`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  }).catch(() => {})
}

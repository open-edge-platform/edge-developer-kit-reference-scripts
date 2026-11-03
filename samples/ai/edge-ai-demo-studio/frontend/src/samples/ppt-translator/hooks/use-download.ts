// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'
import { downloadBlob } from '@/lib/browser/download'
import { fetchOk } from '@/lib/browser/fetch-json'
import { toSafeJobId } from '../lib/job-id'

async function downloadTranslation(jobId: string): Promise<void> {
  const safeJobId = toSafeJobId(jobId)
  const response = await fetchOk(
    `/api/samples/ppt-translator/download/${safeJobId}`,
    { errorMessage: 'Download failed' },
  )
  downloadBlob(await response.blob(), `translated_${safeJobId}.pptx`)
}

/** Saves a finished job's translated deck as `translated_<id>.pptx`. */
export function useDownload() {
  return useMutation<void, Error, string>({ mutationFn: downloadTranslation })
}

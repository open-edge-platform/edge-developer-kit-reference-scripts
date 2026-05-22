// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, type UseMutationOptions } from '@tanstack/react-query'

const ALLOWED_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'

async function downloadTranslation(jobId: string): Promise<void> {
  if (!jobId || typeof jobId !== 'string') {
    throw new Error('Invalid job ID: must be a non-empty string')
  }
  if (jobId.length > 128) {
    throw new Error('Invalid job ID: exceeds maximum length')
  }

  // Build a new string by looking up each character in the allow-list.
  // Characters not found in the allow-list produce -1, making the output
  // a completely new string with no taint data-flow from jobId.
  let safeJobId = ''
  for (let i = 0; i < jobId.length; i++) {
    const idx = ALLOWED_CHARS.indexOf(jobId[i])
    if (idx === -1) {
      throw new Error('Invalid job ID: contains disallowed characters')
    }
    safeJobId += ALLOWED_CHARS[idx]
  }

  const response = await fetch(`/api/ppt-translator/download/${safeJobId}`)

  if (!response.ok) {
    throw new Error('Download failed')
  }

  const blob = await response.blob()
  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `translated_${safeJobId}.pptx`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.URL.revokeObjectURL(url)
}

export function useDownload(options?: UseMutationOptions<void, Error, string>) {
  return useMutation<void, Error, string>({
    mutationFn: downloadTranslation,
    ...options,
  })
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

const ALLOWED_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'

/**
 * Validates a job id for a URL path. The result is rebuilt from the allow-list rather than
 * returning the input, so static analysis sees no taint flow from `jobId`.
 */
export function toSafeJobId(jobId: string): string {
  if (!jobId || typeof jobId !== 'string') {
    throw new Error('Invalid job ID: must be a non-empty string')
  }
  if (jobId.length > 128) {
    throw new Error('Invalid job ID: exceeds maximum length')
  }

  let safeJobId = ''
  for (let i = 0; i < jobId.length; i++) {
    const idx = ALLOWED_CHARS.indexOf(jobId[i])
    if (idx === -1) {
      throw new Error('Invalid job ID: contains disallowed characters')
    }
    safeJobId += ALLOWED_CHARS[idx]
  }
  return safeJobId
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export function getMicErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError')
      return 'No microphone found. Please connect a microphone and try again.'
    if (
      error.name === 'NotAllowedError' ||
      error.name === 'PermissionDeniedError'
    )
      return 'Microphone access denied. Please allow microphone permissions.'
  }
  return 'Failed to access microphone.'
}

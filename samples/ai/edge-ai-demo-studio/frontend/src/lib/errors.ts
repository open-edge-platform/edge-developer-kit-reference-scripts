// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// Isomorphic: no DOM, Node or UI imports.

const DEFAULT_FALLBACK = 'An unexpected error occurred.'

/** Message of a thrown `Error`, string or `{ message }` object (e.g. a cross-realm DOMException). */
export function getErrorMessage(
  err: unknown,
  fallback: string = DEFAULT_FALLBACK,
): string {
  if (err instanceof Error) return err.message || fallback
  if (typeof err === 'string') return err.trim() || fallback
  if (
    err &&
    typeof err === 'object' &&
    'message' in err &&
    typeof err.message === 'string' &&
    err.message
  ) {
    return err.message
  }
  return fallback
}

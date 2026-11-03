// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Kept jobs remembered in `sessionStorage`, so a tab reload can come back to them. Best effort: with
 * storage full or disabled, a job is kept only for the page's life.
 */

const PREFIX = 'kept-job:'

/** What is remembered of a kept job: its id and a JSON summary of its input. */
export interface KeptJobRecord<TSaved> {
  jobId: string
  saved: TSaved
  /** When the worker accepted it (epoch ms). */
  acceptedAt: number
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

export function readKeptJob<TSaved>(key: string): KeptJobRecord<TSaved> | null {
  try {
    const raw = storage()?.getItem(PREFIX + key)
    if (!raw) return null
    const record = JSON.parse(raw) as Partial<KeptJobRecord<TSaved>>
    if (typeof record.jobId !== 'string' || !record.jobId) return null
    return {
      jobId: record.jobId,
      saved: record.saved as TSaved,
      acceptedAt: Number(record.acceptedAt) || 0,
    }
  } catch {
    return null
  }
}

export function writeKeptJob<TSaved>(
  key: string,
  record: KeptJobRecord<TSaved>,
): void {
  try {
    storage()?.setItem(PREFIX + key, JSON.stringify(record))
  } catch {
    // Full or disabled: the job is kept for this page's life only.
  }
}

export function forgetKeptJob(key: string): void {
  try {
    storage()?.removeItem(PREFIX + key)
  } catch {
    // Nothing to forget.
  }
}

/** A JSON value remembered under `key` (any shape), or `null`. */
export function readKeptValue<T>(key: string): T | null {
  try {
    const raw = storage()?.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

/** Remembers `value` under `key` (`null` forgets it); `false` when storage refused it. */
export function writeKeptValue(key: string, value: unknown): boolean {
  try {
    const store = storage()
    if (!store) return false
    if (value === null) store.removeItem(PREFIX + key)
    else store.setItem(PREFIX + key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

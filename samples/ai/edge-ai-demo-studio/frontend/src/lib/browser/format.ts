// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Formats a duration in seconds as `m:ss` (minutes and seconds both floored). */
export function formatClock(seconds: number): string {
  const floored = Math.floor(seconds)
  const mins = Math.floor(floored / 60)
  const secs = floored % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/** Elapsed time of a running operation as `m:ss`, the format every startup and job timer uses. */
export function formatElapsed(ms: number): string {
  return formatClock(Math.max(0, ms) / 1000)
}

/** `1 file`, `3 files`. */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** A setting given in whole seconds: `45s`, `2m`, `2m 30s`. */
export function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`
}

/** `512 KB`, `3.4 MB`, `1.25 GB` — a file or download size. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

/** `342 ms`, `1.25 s`, `12.4 s`, then `m:ss` from a minute up. */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
  return formatClock(ms / 1000)
}

const compactNumber = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** `1284` → `1.3K`, `12` → `12`. */
export function formatCompactNumber(value: number): string {
  return compactNumber.format(value)
}

/** Local wall-clock time of an ISO timestamp, e.g. `10:42`. */
export function formatTimeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** `just now`, `12s ago`, `3 min ago`, `2 h ago`; relative to `now`, so stable across renders. */
export function formatTimeAgo(
  then: string | number | Date,
  now: string | number | Date,
): string {
  const seconds = Math.max(
    0,
    Math.round((new Date(now).getTime() - new Date(then).getTime()) / 1000),
  )
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.floor(minutes / 60)} h ago`
}

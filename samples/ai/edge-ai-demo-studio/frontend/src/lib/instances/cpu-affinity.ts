// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * `numactl -C` CPU lists ("0-7", "0,2,4-6"), shared by the picker and the launcher so the UI never
 * accepts a pin the launcher drops. On Windows the launcher turns the list into an affinity mask.
 */

import type { HostOS } from '@/types/common'

const CPU_AFFINITY_RE = /^\s*\d+(-\d+)?(\s*,\s*\d+(-\d+)?)*\s*$/

/** True iff `value` is empty or a valid numactl -C list. */
export function isCpuAffinityValid(value: string): boolean {
  const trimmed = value.trim()
  return trimmed === '' || CPU_AFFINITY_RE.test(trimmed)
}

export function normalizeCpuAffinity(value: string): string {
  return value.trim().replace(/\s+/g, '')
}

/** The canonical list for the command line, or `null` (launch unpinned) when empty or malformed. */
export function toNumactlCpuList(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (!CPU_AFFINITY_RE.test(trimmed)) return null
  return normalizeCpuAffinity(trimmed)
}

/** Expand a numactl -C list to a Set of CPU IDs. Ignores invalid input. */
export function parseCpuAffinity(value: string): Set<number> {
  const out = new Set<number>()
  const trimmed = value.trim()
  if (!trimmed) return out
  if (!CPU_AFFINITY_RE.test(trimmed)) return out
  for (const part of trimmed.split(',')) {
    const seg = part.trim()
    if (!seg) continue
    if (seg.includes('-')) {
      const [lo, hi] = seg.split('-').map((n) => Number(n.trim()))
      if (Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi) {
        for (let i = lo; i <= hi; i++) out.add(i)
      }
    } else {
      const n = Number(seg)
      if (Number.isFinite(n)) out.add(n)
    }
  }
  return out
}

/** Whether services can be pinned on `os`: numactl on Linux, a process affinity mask on Windows. */
export function supportsCpuAffinity(os: HostOS | undefined): boolean {
  return os === 'linux' || os === 'windows'
}

/**
 * A numactl -C list as a hex Windows affinity mask ("0-3,8" is "10F"), or `null` when it is empty,
 * malformed or names a CPU past 63: a process mask covers one processor group of 64.
 */
export function toWindowsAffinityMask(
  value: string | undefined,
): string | null {
  const cpus = [...parseCpuAffinity(value ?? '')]
  if (cpus.length === 0 || cpus.some((n) => n > 63)) return null
  // BigInt: a Number mask would lose CPUs past bit 52.
  let mask = BigInt(0)
  for (const n of cpus) mask |= BigInt(1) << BigInt(n)
  return mask.toString(16).toUpperCase()
}

/** Collapse a set of CPU IDs to a canonical numactl -C list ("0-7,9,11-13"). */
export function formatCpuAffinity(cores: Iterable<number>): string {
  const sorted = [...new Set(cores)]
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  const segments: string[] = []
  let runStart = sorted[0]
  let runEnd = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === runEnd + 1) {
      runEnd = sorted[i]
    } else {
      segments.push(
        runStart === runEnd ? `${runStart}` : `${runStart}-${runEnd}`,
      )
      runStart = sorted[i]
      runEnd = sorted[i]
    }
  }
  segments.push(runStart === runEnd ? `${runStart}` : `${runStart}-${runEnd}`)
  return segments.join(',')
}

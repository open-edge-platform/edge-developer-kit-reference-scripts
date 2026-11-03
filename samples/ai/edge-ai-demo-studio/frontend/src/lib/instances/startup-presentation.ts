// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Wording of a start's reported step and progress. Only measured progress is shown: a percentage
 * needs a total, and nothing estimates time. Isomorphic: the server logs the same words.
 */

import { formatBytes, plural } from '@/lib/browser/format'
import type {
  StartupProgress,
  StartupStage,
  StartupTelemetry,
} from '@/lib/instances/runtime-fields'

export const STARTUP_STAGE_LABEL: Record<StartupStage, string> = {
  downloading: 'Downloading',
  preparing: 'Preparing',
  'loading-model': 'Loading model',
  'checking-readiness': 'Checking readiness',
}

/** `Downloading model.bin`, `Checking readiness`. */
export function describeStartupStep(
  startup: Pick<StartupTelemetry, 'stage' | 'detail'>,
): string | undefined {
  if (!startup.stage) return undefined
  const label = STARTUP_STAGE_LABEL[startup.stage]
  return startup.detail ? `${label} ${startup.detail}` : label
}

function amount(value: number, unit: StartupProgress['unit']): string {
  return unit === 'bytes' ? formatBytes(value) : String(value)
}

/** Whole percent, only when a total was reported. */
export function startupProgressPercent(
  progress: StartupProgress,
): number | undefined {
  if (!progress.total) return undefined
  return Math.min(100, Math.floor((progress.current / progress.total) * 100))
}

/**
 * `1.20 GB of 4.00 GB (30%)`, `3 of 12 files (25%)` with a total;
 * `350.0 MB so far`, `3 files so far` without one.
 */
export function formatStartupProgress(progress: StartupProgress): string {
  const { current, total, unit } = progress
  const percent = startupProgressPercent(progress)
  if (total && percent !== undefined) {
    const of =
      unit === 'files'
        ? `${current} of ${plural(total, 'file')}`
        : `${amount(current, unit)} of ${amount(total, unit)}`
    return `${of} (${percent}%)`
  }
  return unit === 'files'
    ? `${plural(current, 'file')} so far`
    : `${amount(current, unit)} so far`
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * How a service runs (its own worker, an engine, or no process) and, for a service listing several
 * modes, which one a row runs under. Shared by client and server code.
 */

import type {
  ExecutionMode,
  ExecutionModeOption,
  ServiceExecution,
} from './types'

export function getExecutionModes(
  execution: ServiceExecution,
): ExecutionMode[] {
  return Array.isArray(execution.mode) ? execution.mode : [execution.mode]
}

export function hasExecutionMode(
  execution: ServiceExecution,
  target: ExecutionMode,
): boolean {
  return getExecutionModes(execution).includes(target)
}

/**
 * The mode a service runs under given its stored engine: a single-mode service ignores it, a
 * multi-mode one follows it when listed, else the first mode. Keep in step with the server's
 * `getRowExecutionMode` (`src/lib/workers/execution-mode.ts`).
 */
export function resolveExecutionMode(
  execution: ServiceExecution,
  engine: string | undefined | null,
): ExecutionMode {
  const modes = getExecutionModes(execution)
  if (modes.length === 1) return modes[0]
  const stored = modes.find((mode) => mode === engine)
  return stored ?? modes[0]
}

export function getExecutionModeOptions(
  execution: ServiceExecution,
): ExecutionModeOption[] {
  const modes = getExecutionModes(execution)
  return modes.map(
    (mode) =>
      execution.options?.find((o) => o.mode === mode) ?? {
        mode,
        label: mode === 'worker' ? 'Worker' : mode,
      },
  )
}

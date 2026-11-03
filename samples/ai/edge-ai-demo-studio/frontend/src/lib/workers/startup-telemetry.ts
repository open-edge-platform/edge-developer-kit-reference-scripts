// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * In-memory record of instance start attempts, served as each row's `startup` on
 * `GET /api/services`. Fed by worker stdout reports and engine start code; not stored on the row.
 */

import { globalSingleton } from '@/lib/global-singleton'
import type { StartupTelemetry } from '@/lib/instances/runtime-fields'
import type { PayloadStatus } from '@/lib/instances/service-status'
import { describeStartupStep } from '@/lib/instances/startup-presentation'
import { appendProcessLog } from '@/lib/workers/process-handler'
import {
  createStartupTracker,
  sanitizeStartupText,
  type StartupEvent,
} from '@/lib/workers/startup-events'

// On `globalThis`: the service hooks, the poller and the routes are bundled
// separately in dev and must share one record.
const tracker = globalSingleton('startupTelemetry', () =>
  createStartupTracker(),
)

export type { StartupEvent } from '@/lib/workers/startup-events'

/** Begins a new start attempt for an instance process; its id. */
export function beginStartupAttempt(processName: string): string {
  return tracker.begin(processName)
}

/** The current attempt's id — what an engine start reports under. */
export function currentStartupAttempt(processName: string): string | undefined {
  return tracker.currentId(processName)
}

/**
 * Records a report for `attemptId` (ignored unless current). Steps and failures also go into the
 * instance's log; a failure as an error line, which "View errors" filters to, so it cites that log.
 */
export function recordStartupEvent(
  processName: string,
  attemptId: string,
  event: StartupEvent,
): void {
  const recorded: StartupEvent =
    event.type === 'failure'
      ? {
          type: 'failure',
          summary: sanitizeStartupText(event.summary),
          source: `service:${processName}`,
        }
      : event
  if (!tracker.apply(processName, attemptId, recorded)) return
  if (recorded.type === 'stage') {
    appendProcessLog(
      processName,
      'info',
      `Startup: ${describeStartupStep(recorded)}`,
    )
  } else if (recorded.type === 'failure') {
    appendProcessLog(
      processName,
      'error',
      `Startup failed: ${recorded.summary}`,
    )
  }
}

/** The current attempt failed: kept, unchanged, for the error row. */
export function failStartupAttempt(processName: string): void {
  tracker.fail(processName)
}

/** The instance is running: its start is over. */
export function completeStartupAttempt(processName: string): void {
  tracker.complete(processName)
}

/** A stop ended the start in progress (a failed attempt stays). */
export function cancelStartupAttempt(processName: string): void {
  tracker.cancel(processName)
}

/** A row's `startup` field for its stored status. */
export function getStartupTelemetry(
  processName: string,
  status: PayloadStatus | null | undefined,
): StartupTelemetry | null {
  return tracker.snapshot(processName, status)
}

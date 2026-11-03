// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Fields `GET /api/services` adds to each row from the server's memory of its processes. Never
 * stored: an app restart restarts every worker, so memory holds what actually runs.
 */

/** What the running process was started with; compared with the saved row for "Restart to apply". */
export interface AppliedConfig {
  /** ISO time. */
  startedAt: string
  model?: string
  device?: string
  backend?: string
  quant?: string
  source?: string
  params?: string
  /** The model's task type on an engine (`chat`, `embeddings`, …). */
  modelType?: string
  /** `worker` or an engine id. */
  engine?: string
  metadata?: Record<string, unknown>
  /** Saved settings this run does not use yet; browser-only settings never count (they apply at once). */
  unapplied: AppliedDifference[]
}

export interface AppliedDifference {
  /** A field of {@link AppliedConfig}, or `metadata.<key>`. */
  key: string
  running: string | null
  saved: string | null
}

/** Only stages a producer actually emits appear; without telemetry the UI says Starting. */
export type StartupStage =
  'downloading' | 'preparing' | 'loading-model' | 'checking-readiness'

export type StartupProgressUnit = 'bytes' | 'files'

export interface StartupProgress {
  current: number
  /** Without it, no percentage is shown. */
  total?: number
  unit: StartupProgressUnit
}

export interface StartupFailure {
  /** One short, sanitised line: never raw log contents, tokens or paths. */
  summary: string
  /** Log source key (`<type>:<target>`, see `logSourceKey`) whose log holds the error line. */
  source?: string
}

/** Progress of the current (or failed) start attempt, from the producers' own reports. */
export interface StartupTelemetry {
  /** Unique per start; a retry gets a new one, so old progress never shows. */
  attemptId: string
  startedAt: string
  /**
   * The step reported last; absent before the first report, after a step ended, and for producers
   * that report nothing. A failed attempt keeps the step it failed in.
   */
  stage?: StartupStage
  /** What the step works on (a file, a model) or what it does. */
  detail?: string
  stageStartedAt?: string
  /** When the last report arrived. */
  updatedAt: string
  progress?: StartupProgress
  failure?: StartupFailure
}

/** Absent: unknown. */
export interface ServiceRuntimeFields {
  applied?: AppliedConfig | null
  startup?: StartupTelemetry | null
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * The startup line protocol workers print on stdout (`worker_common/startup.py`) and the attempt
 * bookkeeping behind a row's `startup` field. Each start gets a new attempt id and reports count only
 * for theirs, so a retry never shows stale progress. Type imports only, so it is testable alone.
 */

import type {
  StartupProgressUnit,
  StartupStage,
  StartupTelemetry,
} from '@/lib/instances/runtime-fields'
import type { PayloadStatus } from '@/lib/instances/service-status'

/** What every report line starts with (`PREFIX` in `startup.py`). */
const STARTUP_LINE_PREFIX = 'EDGE_AI_STUDIO_STARTUP '

/** Set for a process whose reports the app reads (`ENABLE_ENV`). */
export const STARTUP_EVENTS_ENV = 'EDGE_AI_STUDIO_STARTUP_EVENTS'

const STAGES: readonly StartupStage[] = [
  'downloading',
  'preparing',
  'loading-model',
  'checking-readiness',
]
const UNITS: readonly StartupProgressUnit[] = ['bytes', 'files']

const DETAIL_LIMIT = 120
const SUMMARY_LIMIT = 200

/** One report, as a producer made it. */
export type StartupEvent =
  /** The producer is now in `stage`; its progress and failure start over. */
  | { type: 'stage'; stage: StartupStage; detail?: string }
  /** How far `stage` is; ignored once another stage is current. */
  | {
      type: 'progress'
      stage: StartupStage
      current: number
      total?: number
      unit: StartupProgressUnit
    }
  /** `stage` is over: back to the generic Starting. */
  | { type: 'stage-end'; stage: StartupStage }
  /** Why the start failed; `source`: the log that has the error line. */
  | { type: 'failure'; summary: string; source?: string }

// Matching from the start of the run of scheme characters scans a long run without "://" once,
// keeping this linear on any input. Same in startup.py.
const URL_PATTERN =
  /(?<![a-z0-9+.-])(?=(?<!_)[a-z]|[a-z0-9+.-]*?[+.-][a-z])([a-z0-9+.-]*):\/\/(?:[^\s/@]*@)?([^\s/?#'"<>]+)([^\s?#'"<>]*)(?:[?#][^\s'"<>]*)?/gi
const PATH_PATTERN =
  /(?<![\w:/.\\])(?:[A-Za-z]:)?(?:[\\/][^\s\\/'"`<>]+){2,}[\\/]?/g
const HF_TOKEN = /\bhf_[A-Za-z0-9]{6,}/g
const AUTH_SCHEME = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi
const SECRET_FIELD =
  /\b(token|access_token|api[_-]?key|apikey|password|passwd|secret|authorization|auth)(["']?\s*[=:]\s*["']?)[^\s"'&,;]+/gi
// A 40+ character run is a token when 16 consecutive alphanumerics mix letters and digits, so a long
// model name made of words stays readable.
const LONG_RUN = /\b[A-Za-z0-9_-]{40,}\b/g
const TOKEN_PART =
  /(?<![A-Za-z0-9])(?=[A-Za-z]*[0-9])(?=[0-9]*[A-Za-z])[A-Za-z0-9]{16}/

/**
 * The first line of `text`, safe to show: credentials masked, URLs cut to host and path, absolute
 * paths to their last part, at most `limit` characters. Mirrors `safe_text` in `startup.py`.
 */
export function sanitizeStartupText(
  text: string,
  limit = SUMMARY_LIMIT,
): string {
  const first =
    text
      .split(/\r\n|\r|\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  const value = first
    .replace(
      URL_PATTERN,
      (_m, scheme, host, path) => `${scheme}://${host}${path}`,
    )
    .replace(HF_TOKEN, 'hf_***')
    .replace(AUTH_SCHEME, (_m, scheme) => `${scheme} ***`)
    .replace(SECRET_FIELD, (_m, field, sep) => `${field}${sep}***`)
    .replace(
      PATH_PATTERN,
      (path) => path.split(/[\\/]/).filter(Boolean).pop() ?? '',
    )
    .replace(LONG_RUN, (run) => (TOKEN_PART.test(run) ? '***' : run))
    .replace(/\s+/g, ' ')
    .trim()
  return value.length > limit
    ? `${value.slice(0, limit - 1).trimEnd()}…`
    : value
}

function isStage(value: unknown): value is StartupStage {
  return STAGES.includes(value as StartupStage)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** The report a stdout line carries, or `null` if none or invalid. Text is sanitized here regardless. */
export function parseStartupLine(line: string): StartupEvent | null {
  const text = line.trimStart()
  if (!text.startsWith(STARTUP_LINE_PREFIX)) return null
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(STARTUP_LINE_PREFIX.length))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const event = raw as Record<string, unknown>
  switch (event.event) {
    case 'stage': {
      if (!isStage(event.stage)) return null
      const detail =
        typeof event.detail === 'string'
          ? sanitizeStartupText(event.detail, DETAIL_LIMIT)
          : ''
      return { type: 'stage', stage: event.stage, ...(detail && { detail }) }
    }
    case 'progress': {
      if (!isStage(event.stage) || !isCount(event.current)) return null
      const unit = event.unit as StartupProgressUnit
      if (!UNITS.includes(unit)) return null
      return {
        type: 'progress',
        stage: event.stage,
        current: event.current,
        unit,
        ...(isCount(event.total) && event.total > 0 && { total: event.total }),
      }
    }
    case 'stage-end':
      return isStage(event.stage)
        ? { type: 'stage-end', stage: event.stage }
        : null
    case 'failure': {
      const summary =
        typeof event.summary === 'string'
          ? sanitizeStartupText(event.summary)
          : ''
      return summary ? { type: 'failure', summary } : null
    }
    default:
      return null
  }
}

interface Attempt {
  telemetry: StartupTelemetry
  /** `failed`: frozen for its error row. */
  state: 'running' | 'failed'
}

/** The start attempts of every instance process (`type@instanceId`). */
export interface StartupTracker {
  /** A new attempt for `name`, replacing any earlier one; its id. */
  begin(name: string): string
  /** The id of `name`'s current attempt, if any. */
  currentId(name: string): string | undefined
  /**
   * Applies a report for `attemptId`. False, changing nothing, when that attempt is not current or is
   * settled, or the report is out of order (another stage's progress, or behind what is shown).
   */
  apply(name: string, attemptId: string, event: StartupEvent): boolean
  /** The current attempt failed: frozen, kept for the error row. */
  fail(name: string): void
  /** The start succeeded: forgotten. */
  complete(name: string): void
  /** A stop ended a start in progress: forgotten (a failed one is kept). */
  cancel(name: string): void
  /** The running attempt while the row starts, the failed one while it is in error, else `null`. */
  snapshot(
    name: string,
    status: PayloadStatus | null | undefined,
  ): StartupTelemetry | null
}

function withoutStage(t: StartupTelemetry): StartupTelemetry {
  return {
    attemptId: t.attemptId,
    startedAt: t.startedAt,
    updatedAt: t.updatedAt,
    ...(t.failure && { failure: t.failure }),
  }
}

export function createStartupTracker({
  now = () => new Date(),
  newId = () => globalThis.crypto.randomUUID(),
}: { now?: () => Date; newId?: () => string } = {}): StartupTracker {
  const attempts = new Map<string, Attempt>()

  const update = (attempt: Attempt, next: StartupTelemetry): true => {
    attempt.telemetry = { ...next, updatedAt: now().toISOString() }
    return true
  }

  return {
    begin(name) {
      const at = now().toISOString()
      const attemptId = newId()
      attempts.set(name, {
        telemetry: { attemptId, startedAt: at, updatedAt: at },
        state: 'running',
      })
      return attemptId
    },

    currentId(name) {
      return attempts.get(name)?.telemetry.attemptId
    },

    apply(name, attemptId, event) {
      const attempt = attempts.get(name)
      if (!attempt || attempt.telemetry.attemptId !== attemptId) return false
      const t = attempt.telemetry

      // A failure line can trail the exit that failed the attempt; nothing
      // else may change a failed attempt.
      if (attempt.state === 'failed') {
        if (event.type !== 'failure' || t.failure) return false
        return update(attempt, { ...t, failure: failureOf(event) })
      }

      switch (event.type) {
        case 'stage':
          // A new step: the last one's progress and failure no longer apply.
          return update(attempt, {
            attemptId: t.attemptId,
            startedAt: t.startedAt,
            updatedAt: t.updatedAt,
            stage: event.stage,
            ...(event.detail && { detail: event.detail }),
            stageStartedAt: now().toISOString(),
          })
        case 'progress': {
          if (t.stage !== event.stage) return false
          const shown = t.progress
          if (
            shown &&
            shown.unit === event.unit &&
            event.current < shown.current
          ) {
            return false
          }
          // A total below the count is no total at all.
          const total =
            event.total !== undefined && event.total >= event.current
              ? event.total
              : undefined
          return update(attempt, {
            ...t,
            progress: {
              current: event.current,
              unit: event.unit,
              ...(total !== undefined && { total }),
            },
          })
        }
        case 'stage-end':
          if (t.stage !== event.stage) return false
          return update(attempt, withoutStage(t))
        case 'failure':
          return update(attempt, { ...t, failure: failureOf(event) })
      }
    },

    fail(name) {
      const attempt = attempts.get(name)
      if (!attempt || attempt.state === 'failed') return
      attempt.state = 'failed'
      attempt.telemetry = {
        ...attempt.telemetry,
        updatedAt: now().toISOString(),
      }
    },

    complete(name) {
      attempts.delete(name)
    },

    cancel(name) {
      if (attempts.get(name)?.state === 'running') attempts.delete(name)
    },

    snapshot(name, status) {
      const attempt = attempts.get(name)
      if (!attempt) return null
      if (status === 'prepare' || status === 'restart') {
        return attempt.state === 'running' ? clean(attempt.telemetry) : null
      }
      return status === 'error' ? clean(attempt.telemetry) : null
    },
  }
}

function failureOf(event: { summary: string; source?: string }) {
  return {
    summary: event.summary,
    ...(event.source && { source: event.source }),
  }
}

/** The telemetry without keys set to `undefined` (what JSON would drop). */
function clean(t: StartupTelemetry): StartupTelemetry {
  return Object.fromEntries(
    Object.entries(t).filter(([, value]) => value !== undefined),
  ) as unknown as StartupTelemetry
}

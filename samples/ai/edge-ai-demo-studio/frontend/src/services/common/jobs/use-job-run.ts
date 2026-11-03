// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffectEvent, useLayoutEffect } from 'react'
import { useLeaveGuard } from '@/components/common/leave-guard'
import { useSessionResource } from '../demo/session-store'
import { useStoreSnapshot } from '../demo/snapshot-store'
import {
  type JobDefinition,
  type JobPhase,
  JobRunner,
  type JobSnapshot,
  type JobStatusLike,
  keptJobRunner,
} from './job-run'

export interface JobRunState<
  TInput,
  TStatus,
  TResult,
  TSaved = undefined,
> extends Omit<JobSnapshot<TStatus, TResult>, 'phase'> {
  /** `idle` before the first run and after `reset`. */
  phase: JobPhase | 'idle'
  /** The latest run's input; `null` for a kept job picked up after a reload (see `saved`). */
  input: TInput | null
  /** With `keep`: what was saved of the latest run's input. */
  saved: TSaved | null
  /** Sending, queued or running. */
  isActive: boolean
  /** Runs the job, abandoning one still going; resolves with the settled snapshot, never rejects. */
  start: (input: TInput) => Promise<JobSnapshot<TStatus, TResult>>
  /** Cancels the latest run's job on the worker; it settles `cancelled`. */
  cancel: () => void
  /** Abandons the latest run (cancelling its job) and goes back to `idle`. */
  reset: () => void
}

/** A job the worker keeps by id, so the page can be left while it runs and come back to it. */
export interface KeepJobOptions<TInput, TSaved> {
  /** Names the page's job in this tab (e.g. sample and instance); one job is kept per key. */
  key: string
  /** The JSON-safe part of the input to show after a reload, when e.g. a `File` is gone. */
  save: (input: TInput) => TSaved
}

export interface UseJobRunOptions<TInput, TSaved> {
  /**
   * Keeps the runner in the demo session: the run outlives a remount for another instance and is
   * disposed when the session ends.
   */
  sessionKey?: string
  /**
   * `false` for a job whose result the worker keeps (a saved avatar): disposing stops following it
   * instead of cancelling. `reset` and a newer run still cancel.
   */
  cancelOnDispose?: boolean
  /**
   * Keeps the job running when the page goes away (navigation, Back, reload) and comes back to it.
   * Overrides `sessionKey` and `cancelOnDispose`.
   */
  keep?: KeepJobOptions<TInput, TSaved>
  /** Names the job (e.g. `translation`) in the prompt shown before leaving while it is active. */
  leaveGuardNoun?: string
}

const IDLE: JobSnapshot<never, never> = {
  phase: 'submitting',
  jobId: null,
  status: null,
  result: null,
  error: null,
  cancelling: false,
  resumed: false,
  gone: false,
}

/**
 * A cancellable worker job (see `job-run.ts`): the latest run wins, and the job is cancelled once
 * nothing can show its result (reset, unmount, or with `sessionKey` the session ending).
 */
export function useJobRun<
  TInput,
  TStatus extends JobStatusLike,
  TResult,
  TSaved = undefined,
>(
  definition: JobDefinition<TInput, TStatus, TResult>,
  {
    sessionKey,
    cancelOnDispose = true,
    keep,
    leaveGuardNoun,
  }: UseJobRunOptions<TInput, TSaved> = {},
): JobRunState<TInput, TStatus, TResult, TSaved> {
  const keepKey = keep?.key
  const runner = useSessionResource(
    keepKey === undefined ? sessionKey : undefined,
    () =>
      keepKey === undefined
        ? new JobRunner<TInput, TStatus, TResult, TSaved>(cancelOnDispose)
        : keptJobRunner<TInput, TStatus, TResult, TSaved>(keepKey),
    // A kept runner outlives the view: its job is left running.
    (owned) => {
      if (owned.keepKey === undefined) owned.dispose()
    },
  )
  const run = useStoreSnapshot(runner)
  const snapshot = useStoreSnapshot(run, IDLE as JobSnapshot<TStatus, TResult>)
  const phase = run ? snapshot.phase : 'idle'
  const isActive =
    phase === 'submitting' || phase === 'queued' || phase === 'running'

  // After a reload only `sessionStorage` knows a kept job: follow it again
  // before the first paint, so the empty form never flashes.
  const resumeKept = useEffectEvent(() => runner.resume(definition))
  useLayoutEffect(() => {
    resumeKept()
  }, [runner])

  const leavingKeepsIt = runner.keepKey !== undefined || !cancelOnDispose
  useJobLeaveGuard(
    isActive && leaveGuardNoun !== undefined,
    leaveGuardNoun ?? 'job',
    leavingKeepsIt
      ? runner.keepKey !== undefined
        ? 'resumes'
        : 'continues'
      : 'cancels',
  )

  return {
    ...snapshot,
    phase,
    input: run?.input ?? null,
    saved: run?.saved ?? null,
    isActive,
    start: (input) => runner.start(definition, input, keep?.save(input)),
    cancel: () => runner.cancel(),
    reset: () => runner.reset(),
  }
}

/**
 * What leaving does to an active job: `resumes` (shown again on return), `continues` (keeps
 * running, no longer followed) or `cancels`.
 */
type JobLeaveOutcome = 'resumes' | 'continues' | 'cancels'

/**
 * Asks before leaving while `active`, saying what happens to the job. Browser Back is not guarded
 * (see `useLeaveGuard`), so `resumes` jobs must come back on return.
 */
function useJobLeaveGuard(
  active: boolean,
  noun: string,
  outcome: JobLeaveOutcome,
) {
  const copy = JOB_LEAVE_COPY[outcome](noun)
  useLeaveGuard(active, copy)
}

const JOB_LEAVE_COPY: Record<
  JobLeaveOutcome,
  (noun: string) => {
    title: string
    description: string
    confirmLabel: string
    cancelLabel: string
  }
> = {
  resumes: (noun) => ({
    title: `Leave while the ${noun} runs?`,
    description: `The ${noun} keeps running on the worker. Come back to this page to follow it and get the result.`,
    confirmLabel: 'Leave page',
    cancelLabel: 'Stay on page',
  }),
  continues: (noun) => ({
    title: `Leave while the ${noun} runs?`,
    description: `The ${noun} keeps running on the worker, but this page stops following it.`,
    confirmLabel: 'Leave page',
    cancelLabel: 'Stay on page',
  }),
  cancels: (noun) => ({
    title: `Leave and cancel the ${noun}?`,
    description: `Leaving this page cancels the ${noun} on the worker, and its progress is lost.`,
    confirmLabel: `Leave and cancel`,
    cancelLabel: 'Stay on page',
  }),
}

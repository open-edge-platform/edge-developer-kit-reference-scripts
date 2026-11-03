// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * A worker's cancellable background job from the browser: send it, follow its status stream to a
 * final status, and cancel it on the worker, even before its id is known or once nothing wants it.
 */

import { isHttpError } from '@/lib/browser/fetch-json'
import { CANCELLED, cancelJob, followStatusEvents } from '@/lib/browser/sse'
import { recordJob } from '@/services/common/metrics/work'
import { SnapshotStore } from '../demo/snapshot-store'
import { forgetKeptJob, readKeptJob, writeKeptJob } from './kept-jobs'

/** Final statuses across all workers; `not_found` is a job the worker no longer knows. */
const FINAL_JOB_STATUSES: readonly string[] = [
  'completed',
  'done',
  'finished',
  'error',
  'failed',
  CANCELLED,
  'not_found',
]

const QUEUED_JOB_STATUSES: readonly string[] = ['pending', 'queued']

export interface JobStatusLike {
  status: string
  /** Set once a cancel was asked for; the job stops at its next safe point. */
  cancel_requested?: boolean
  /** Once done: what the job measured, for Live metrics (`recordJob`). */
  perf?: unknown
}

export type JobPhase =
  'submitting' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface JobSnapshot<TStatus, TResult> {
  phase: JobPhase
  /** Set once the worker accepted the job. */
  jobId: string | null
  /** The latest status the worker reported. */
  status: TStatus | null
  /** Once `done`. */
  result: TResult | null
  /** Once `failed`. */
  error: Error | null
  /** A cancel was asked for and the job has not stopped yet. */
  cancelling: boolean
  /** Sent by an earlier page visit and followed again by id; its input is known only as saved. */
  resumed: boolean
  /** Failed because the worker no longer knows the job (restarted or expired); its result is gone. */
  gone: boolean
}

const JOB_GONE_MESSAGE =
  'The worker no longer has this job: it restarted, or the result expired.'

/** How to run one kind of job. Built per render; read when a run starts. */
export interface JobDefinition<TInput, TStatus extends JobStatusLike, TResult> {
  /** Sends the job and resolves with its id; a job created after `signal` aborts is cancelled. */
  submit: (input: TInput, signal: AbortSignal) => Promise<string>
  /** The job's status path: `DELETE` on it cancels the job. */
  jobUrl: (jobId: string) => string
  /** Its status stream; `<jobUrl>/events` by default. */
  eventsUrl?: (jobId: string) => string
  /** Whether a status is the job's last; by default one of `FINAL_JOB_STATUSES`. */
  isFinal?: (status: TStatus) => boolean
  /** Whether the job is waiting for its turn; by default `pending`/`queued`. */
  isQueued?: (status: TStatus) => boolean
  /** The result of a final, non-cancelled status; throws for a failed job (see `jobFailure`). */
  toResult: (status: TStatus, jobId: string) => TResult
  /** Instance address the finished job's `perf` is recorded for (Live metrics). */
  metricsApiBase?: string
  /** Shown when the status stream is lost. */
  followErrorMessage?: string
}

const isFinalStatus = (status: JobStatusLike) =>
  FINAL_JOB_STATUSES.includes(status.status)
const isQueuedStatus = (status: JobStatusLike) =>
  QUEUED_JOB_STATUSES.includes(status.status)

/** The error a final failed status carries, for `toResult` to throw. */
export function jobFailure(status: unknown, fallback: string): Error {
  const record = (status ?? {}) as Record<string, unknown>
  for (const key of ['error', 'detail', 'message']) {
    const value = record[key]
    if (typeof value === 'string' && value) return new Error(value)
  }
  return new Error(fallback)
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export interface JobRunOptions<TSaved> {
  /** Follow this earlier job instead of sending one; the run starts `running` and `resumed`. */
  jobId?: string
  /** What is remembered of the input, e.g. a file's name (`useJobRun` `keep`). */
  saved?: TSaved
  /** Called once with the job's id, when the worker accepted it. */
  onAccepted?: (jobId: string) => void
  /**
   * Called once with the settled phase when the job is over on the worker (final status or unknown
   * job); not when the run was abandoned, detached or lost its status stream.
   */
  onEnded?: (phase: JobPhase) => void
}

/** One job: sent once (or picked up by its id), followed to its end unless abandoned. */
export class JobRun<
  TInput,
  TStatus extends JobStatusLike,
  TResult,
  TSaved = undefined,
> extends SnapshotStore<JobSnapshot<TStatus, TResult>> {
  /** The settled snapshot; never rejects. */
  readonly done: Promise<JobSnapshot<TStatus, TResult>>
  /** What the job was sent with; `null` for a resumed job (see `saved`). */
  readonly input: TInput | null
  readonly saved: TSaved | undefined
  private readonly controller = new AbortController()
  private cancelRequested = false
  private settled = false

  constructor(
    private readonly definition: JobDefinition<TInput, TStatus, TResult>,
    input: TInput | null,
    private readonly options: JobRunOptions<TSaved> = {},
  ) {
    const resumed = options.jobId !== undefined
    super({
      phase: resumed ? 'running' : 'submitting',
      jobId: options.jobId ?? null,
      status: null,
      result: null,
      error: null,
      cancelling: false,
      resumed,
      gone: false,
    })
    this.input = input
    this.saved = options.saved
    this.done = this.run()
  }

  /** Not settled yet: sending, queued or running. */
  get active(): boolean {
    return !this.settled
  }

  /** Asks the worker to cancel the job (once it has an id); settles `cancelled` when it stops. */
  cancel(): void {
    if (this.settled || this.cancelRequested) return
    this.cancelRequested = true
    const { jobId } = this.snapshot
    if (jobId) cancelJob(this.definition.jobUrl(jobId))
    this.patchSnapshot({ cancelling: true })
  }

  /**
   * Stops following the job but leaves it running on the worker, for a result kept there (e.g. a
   * saved avatar). Settles `cancelled`; a job still being sent is not created.
   */
  detach(): void {
    if (this.settled) return
    this.controller.abort()
  }

  /** Stops following the job and cancels it on the worker, as nothing else holds its id. */
  abandon(): void {
    if (this.settled) return
    const { jobId } = this.snapshot
    if (jobId) cancelJob(this.definition.jobUrl(jobId))
    this.cancelRequested = true
    this.controller.abort()
  }

  private async jobId(signal: AbortSignal): Promise<string> {
    if (this.options.jobId !== undefined) return this.options.jobId
    if (this.input === null) throw new Error('Nothing to send')
    const jobId = await this.definition.submit(this.input, signal)
    // Cancelled while it was being sent: the job exists now, so stop it.
    if (this.cancelRequested) cancelJob(this.definition.jobUrl(jobId))
    if (!signal.aborted) this.options.onAccepted?.(jobId)
    return jobId
  }

  private async run(): Promise<JobSnapshot<TStatus, TResult>> {
    const { definition } = this
    const { signal } = this.controller
    const isFinal = definition.isFinal ?? isFinalStatus
    const isQueued = definition.isQueued ?? isQueuedStatus
    let ended = false
    try {
      const jobId = await this.jobId(signal)
      const url = definition.jobUrl(jobId)
      if (signal.aborted) return this.settle({ phase: 'cancelled' })
      this.patchSnapshot({ jobId, phase: 'running' })

      const final = await followStatusEvents<TStatus>(
        definition.eventsUrl?.(jobId) ?? `${url}/events`,
        {
          signal,
          isFinal,
          onStatus: (status) => {
            if (this.settled || signal.aborted || isFinal(status)) return
            this.patchSnapshot({
              status,
              phase: isQueued(status) ? 'queued' : 'running',
              cancelling:
                this.cancelRequested || Boolean(status.cancel_requested),
            })
          },
          init: {
            errorMessage:
              definition.followErrorMessage ?? 'Lost track of the job',
          },
        },
      )
      // Abandoned while the last status was on its way: nobody wants it.
      if (signal.aborted) return this.settle({ phase: 'cancelled' })
      ended = true
      if (final.status === CANCELLED) {
        return this.settle({ phase: 'cancelled', status: final }, ended)
      }
      const result = definition.toResult(final, jobId)
      recordJob(definition.metricsApiBase, jobId, final.perf)
      return this.settle({ phase: 'done', status: final, result }, ended)
    } catch (error) {
      if (signal.aborted) return this.settle({ phase: 'cancelled' })
      // Only the status stream answers 404: sending never does.
      if (this.snapshot.jobId && isHttpError(error, 404)) {
        return this.settle(
          {
            phase: 'failed',
            error: new Error(JOB_GONE_MESSAGE),
            gone: true,
          },
          true,
        )
      }
      return this.settle({ phase: 'failed', error: asError(error) }, ended)
    }
  }

  private settle(
    patch: Partial<JobSnapshot<TStatus, TResult>>,
    ended = false,
  ): JobSnapshot<TStatus, TResult> {
    this.settled = true
    this.patchSnapshot({ ...patch, cancelling: false })
    if (ended) this.options.onEnded?.(this.snapshot.phase)
    return this.snapshot
  }
}

/**
 * The runs of one view: the latest is shown and starting another abandons it. With a `keepKey`,
 * the latest job's id is remembered from acceptance until it is replaced or ends without a result,
 * and `resume` follows it again.
 */
export class JobRunner<
  TInput,
  TStatus extends JobStatusLike,
  TResult,
  TSaved = undefined,
> extends SnapshotStore<JobRun<TInput, TStatus, TResult, TSaved> | null> {
  constructor(
    private readonly cancelOnDispose = true,
    readonly keepKey?: string,
  ) {
    super(null)
  }

  start(
    definition: JobDefinition<TInput, TStatus, TResult>,
    input: TInput,
    saved?: TSaved,
  ): Promise<JobSnapshot<TStatus, TResult>> {
    this.snapshot?.abandon()
    const { keepKey } = this
    if (keepKey) forgetKeptJob(keepKey)
    const run = new JobRun<TInput, TStatus, TResult, TSaved>(
      definition,
      input,
      {
        saved,
        onAccepted: keepKey
          ? (jobId) => {
              // A newer run may have replaced it while it was being sent.
              if (this.snapshot === run) {
                writeKeptJob(keepKey, { jobId, saved, acceptedAt: Date.now() })
              }
            }
          : undefined,
        onEnded: keepKey ? (phase) => this.forgetEnded(run, phase) : undefined,
      },
    )
    this.setSnapshot(run)
    return run.done
  }

  /** With nothing shown, follows the job kept under `keepKey` again, e.g. after a reload. */
  resume(definition: JobDefinition<TInput, TStatus, TResult>): void {
    if (this.snapshot || !this.keepKey) return
    const kept = readKeptJob<TSaved>(this.keepKey)
    if (!kept) return
    const run = new JobRun<TInput, TStatus, TResult, TSaved>(definition, null, {
      jobId: kept.jobId,
      saved: kept.saved,
      onEnded: (phase) => this.forgetEnded(run, phase),
    })
    this.setSnapshot(run)
  }

  /** Forgets the kept job once it ended without a result; a done job is kept for its result. */
  private forgetEnded(
    run: JobRun<TInput, TStatus, TResult, TSaved>,
    phase: JobPhase,
  ): void {
    if (this.keepKey && this.snapshot === run && phase !== 'done') {
      forgetKeptJob(this.keepKey)
    }
  }

  cancel(): void {
    this.snapshot?.cancel()
  }

  reset(): void {
    this.snapshot?.abandon()
    if (this.keepKey) forgetKeptJob(this.keepKey)
    this.setSnapshot(null)
  }

  dispose(): void {
    if (this.cancelOnDispose) this.snapshot?.abandon()
    else this.snapshot?.detach()
  }
}

const keptRunners = new Map<string, unknown>()

/**
 * The runner of the job kept under `key`, for a worker that keeps jobs by id. Module-level, so the
 * job is still followed while its page is gone; after a reload `resume` picks it up again.
 */
export function keptJobRunner<
  TInput,
  TStatus extends JobStatusLike,
  TResult,
  TSaved,
>(key: string): JobRunner<TInput, TStatus, TResult, TSaved> {
  let runner = keptRunners.get(key) as
    JobRunner<TInput, TStatus, TResult, TSaved> | undefined
  if (!runner) {
    runner = new JobRunner<TInput, TStatus, TResult, TSaved>(false, key)
    keptRunners.set(key, runner)
  }
  return runner
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { getErrorMessage } from '@/lib/errors'
import { fetchOk, isHttpError } from '@/lib/browser/fetch-json'
import { CANCELLED, cancelJob, followStatusEvents } from '@/lib/browser/sse'
import { SnapshotStore } from '@/services/common/demo/snapshot-store'
import {
  forgetKeptJob,
  readKeptJob,
  writeKeptJob,
} from '@/services/common/jobs/kept-jobs'
import { recordJob } from '@/services/common/metrics/work'
import {
  type EditImageRequest,
  type GenerateImageRequest,
  type ImageJobStarted,
  imageJobUrl,
  startEditJob,
  startGenerateJob,
} from './api'

/** A generation or edit job's status, as `GET /v1/images/jobs/{id}/events` sends it. */
export interface ImageJobStatus {
  id: string
  type: 'image-generation' | 'image-edit'
  /** `pending` while queued: the worker makes one image at a time, for every client. */
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | typeof CANCELLED
  /** Place in the worker's queue while `pending`; 1 is next. */
  position?: number | null
  /** Images the job makes, one at a time. */
  n: number
  images_done: number
  /** Seconds waited while `pending`, then seconds since the job started. */
  elapsed_time: number
  /** Seconds, from the rate this instance measured on its own images (OVMS reports no steps). */
  estimated_time: number | null
  /** Seconds one image of this job should take, while it is unfinished. */
  seconds_per_image?: number
  /** Worker clock (epoch seconds): when the job started, while it runs. */
  started?: number
  /** Worker clock (epoch seconds): when the image in the works began. */
  image_started?: number
  /** Set once a cancel was asked for, until the job stops. */
  cancel_requested?: boolean
  error?: string
  /** Once completed: the images, steps and time, for Live metrics. */
  perf?: unknown
}

function isFinal({ status }: ImageJobStatus) {
  return status === 'completed' || status === 'failed' || status === CANCELLED
}

/**
 * Follows the job to the end, then reads its PNGs into object URLs so they outlive the worker's
 * copy. A cancelled job ends with no images.
 */
async function followImageJob(
  jobUrl: string,
  {
    signal,
    onStatus,
  }: { signal: AbortSignal; onStatus: (status: ImageJobStatus) => void },
): Promise<{ status: ImageJobStatus; images: string[] }> {
  const final = await followStatusEvents<ImageJobStatus>(`${jobUrl}/events`, {
    signal,
    isFinal,
    onStatus,
  })
  if (final.status === 'failed') {
    throw new Error(final.error || 'Image generation failed')
  }
  if (final.status === CANCELLED) return { status: final, images: [] }
  const blobs = await Promise.all(
    Array.from({ length: final.images_done }, async (_, index) => {
      const res = await fetchOk(`${jobUrl}/images/${index}`, {
        signal,
        errorMessage: 'Failed to read the generated image',
      })
      return res.blob()
    }),
  )
  return { status: final, images: blobs.map((b) => URL.createObjectURL(b)) }
}

function revokeImages(images: string[] | undefined) {
  images?.forEach((url) => URL.revokeObjectURL(url))
}

/**
 * `starting` until the worker accepts the job; `lost` when following stopped without an outcome
 * (stream dropped, or the worker forgot the job). A lost job is never resent; `reconnect` follows
 * it again.
 */
export type ImageRunPhase =
  'starting' | 'running' | 'failed' | 'cancelled' | 'lost'

/** The request settings an image is labelled with. */
export interface OutputSettings {
  size?: string
  num_inference_steps?: number
}

/** What is remembered of a job for the page coming back to it. */
interface KeptImageJob {
  settings: OutputSettings
  /** It had finished: its images were shown. */
  completed?: boolean
}

export interface ImageRun {
  settings: OutputSettings
  /** Sent by an earlier visit of the page and followed again (`ImageJob.resume`). */
  resumed: boolean
  /** Set once the worker accepted the job. */
  jobId: string | null
  /** The job's latest status; null until the first arrives. */
  status: ImageJobStatus | null
  phase: ImageRunPhase
  /** Why a failed or lost run ended. */
  error: string | null
  /** The user asked to cancel it; it stops before its next image. */
  cancelRequested: boolean
}

interface ImageResult {
  /** The images as object URLs, released with the result. */
  images: string[]
  settings: OutputSettings
}

export interface ImageJobState {
  /** The request in flight, or the last one if it did not succeed. */
  run: ImageRun | null
  /** The last request that produced a usable image. */
  result: ImageResult | null
}

type StartJob<TRequest> = (
  apiBase: string,
  request: TRequest,
) => Promise<ImageJobStarted>

/**
 * The worker keeps a finished job 30 minutes and forgets all jobs on restart; then its paths
 * answer 404 and its stream ends with "Job not found".
 */
function isGone(error: unknown) {
  return (
    isHttpError(error, 404) ||
    (error instanceof Error && error.message === 'Job not found')
  )
}

function followErrorMessage(error: unknown) {
  return isGone(error)
    ? 'The worker no longer has this job: it may have restarted, or the result expired.'
    : getErrorMessage(error, 'Lost the connection to the job')
}

function settingsOf(request: OutputSettings): OutputSettings {
  return {
    size: request.size,
    num_inference_steps: request.num_inference_steps,
  }
}

/**
 * One kind of request (generate or edit) on one instance. Lives in the demo session, not a
 * component, so a job keeps being followed while another instance is shown. Leaving the page does
 * not cancel it: its id is kept under `keepKey` and the next visit resumes it.
 */
export class ImageJob<
  TRequest extends OutputSettings,
> extends SnapshotStore<ImageJobState> {
  private controller: AbortController | null = null
  /** The instance the current run's job was sent to. */
  private apiBase: string | null = null
  private readonly start: StartJob<TRequest>
  /** Called after every change, for the session's busy mark. */
  private readonly onChange: () => void

  constructor(
    start: StartJob<TRequest>,
    onChange: () => void,
    private readonly keepKey: string,
  ) {
    super({ run: null, result: null })
    this.start = start
    this.onChange = onChange
  }

  get active() {
    return isRunActive(this.snapshot.run)
  }

  /** Sends `request` and follows its job; ignored while one is active. */
  submit(apiBase: string, request: TRequest) {
    if (this.active) return
    const controller = this.begin()
    this.apiBase = apiBase
    const settings = settingsOf(request)
    this.update({
      ...this.snapshot,
      run: {
        settings,
        resumed: false,
        jobId: null,
        status: null,
        phase: 'starting',
        error: null,
        cancelRequested: false,
      },
    })
    // Not aborted with the session: once the answer names the job, a release or cancel asked for
    // meanwhile cancels it.
    this.start(apiBase, request).then(
      ({ job_id: jobId }) => {
        if (controller.signal.aborted) {
          if (jobId) cancelJob(imageJobUrl(apiBase, jobId))
          return
        }
        if (!jobId) {
          this.end(controller, 'failed', 'No job ID returned from the worker')
          return
        }
        if (this.snapshot.run?.cancelRequested) {
          cancelJob(imageJobUrl(apiBase, jobId))
        }
        writeKeptJob<KeptImageJob>(this.keepKey, {
          jobId,
          saved: { settings },
          acceptedAt: Date.now(),
        })
        this.follow(apiBase, jobId, controller)
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        this.end(controller, 'failed', getErrorMessage(error, 'Request failed'))
      },
    )
  }

  /** Follows a lost run's job again. The request is not sent again. */
  reconnect(apiBase: string) {
    const run = this.snapshot.run
    if (!run || run.phase !== 'lost' || !run.jobId) return
    this.apiBase = apiBase
    this.follow(apiBase, run.jobId, this.begin())
  }

  /**
   * Follows the job an earlier visit left. A finished job the worker has since forgotten is dropped
   * quietly; a running one is reported `lost`.
   */
  resume(apiBase: string) {
    if (this.snapshot.run || this.snapshot.result) return
    const kept = readKeptJob<KeptImageJob>(this.keepKey)
    if (!kept?.saved?.settings) return
    this.apiBase = apiBase
    this.update({
      ...this.snapshot,
      run: {
        settings: kept.saved.settings,
        resumed: true,
        jobId: kept.jobId,
        status: null,
        phase: 'running',
        error: null,
        cancelRequested: false,
      },
    })
    this.follow(apiBase, kept.jobId, this.begin(), kept.saved.completed)
  }

  /** A queued job is dropped at once, a running one stops before its next image. */
  cancel() {
    const run = this.snapshot.run
    if (!run || !this.active || run.cancelRequested) return
    this.patchRun({ cancelRequested: true })
    // Still being sent: `submit` cancels the job once the worker names it.
    if (run.jobId && this.apiBase) {
      cancelJob(imageJobUrl(this.apiBase, run.jobId))
    }
  }

  /**
   * Stops following (the job keeps running on the worker, for `resume`) and releases the result.
   * A job still being sent is cancelled once the worker names it, as nothing remembers it.
   */
  dispose() {
    this.controller?.abort()
    this.controller = null
    revokeImages(this.snapshot.result?.images)
  }

  private begin() {
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    return controller
  }

  private async follow(
    apiBase: string,
    jobId: string,
    controller: AbortController,
    /** Resuming a job that had finished: drop it quietly if it is gone. */
    finishedBefore = false,
  ) {
    this.patchRun({ jobId, phase: 'running', error: null })
    try {
      const { status, images } = await followImageJob(
        imageJobUrl(apiBase, jobId),
        {
          signal: controller.signal,
          onStatus: (status) => this.patchRun({ status }),
        },
      )
      // A job that finished on an earlier visit was recorded then.
      if (!finishedBefore) recordJob(apiBase, jobId, status.perf)
      const run = this.snapshot.run
      if (controller.signal.aborted || status.status === CANCELLED || !run) {
        revokeImages(images)
        if (!controller.signal.aborted) {
          forgetKeptJob(this.keepKey)
          this.end(controller, 'cancelled', null)
        }
        return
      }
      if (images.length === 0) {
        forgetKeptJob(this.keepKey)
        this.end(controller, 'failed', 'The worker returned no image')
        return
      }
      this.controller = null
      writeKeptJob<KeptImageJob>(this.keepKey, {
        jobId,
        saved: { settings: run.settings, completed: true },
        acceptedAt: Date.now(),
      })
      const previous = this.snapshot.result
      this.update({ run: null, result: { images, settings: run.settings } })
      revokeImages(previous?.images)
    } catch (error) {
      if (controller.signal.aborted) return
      // A failure the job reported is its outcome; anything else leaves the outcome unknown.
      if (this.snapshot.run?.status?.status === 'failed') {
        forgetKeptJob(this.keepKey)
        this.end(controller, 'failed', getErrorMessage(error, 'The job failed'))
      } else if (finishedBefore && isGone(error)) {
        // An image shown on an earlier visit that has expired since.
        forgetKeptJob(this.keepKey)
        if (this.controller === controller) this.controller = null
        this.update({ ...this.snapshot, run: null })
      } else {
        // The worker forgot it: a later visit has nothing to pick up.
        if (isGone(error)) forgetKeptJob(this.keepKey)
        this.end(controller, 'lost', followErrorMessage(error))
      }
    }
  }

  private end(
    controller: AbortController,
    phase: 'failed' | 'cancelled' | 'lost',
    error: string | null,
  ) {
    if (this.controller === controller) this.controller = null
    this.patchRun({ phase, error })
  }

  private patchRun(patch: Partial<ImageRun>) {
    const run = this.snapshot.run
    if (!run) return
    this.update({ ...this.snapshot, run: { ...run, ...patch } })
  }

  private update(state: ImageJobState) {
    this.setSnapshot(state)
    // After the snapshot moved: the session reads `active` from it.
    this.onChange()
  }
}

/** The generate and edit requests of one instance. */
export class ImageJobSession {
  readonly generate: ImageJob<GenerateImageRequest>
  readonly edit: ImageJob<EditImageRequest>
  private busy = false
  private readonly onBusy: (busy: boolean) => void

  /** `keepKey`: the instance, which the remembered jobs are kept under. */
  constructor(onBusy: (busy: boolean) => void, keepKey: string) {
    this.onBusy = onBusy
    const changed = () => {
      const busy = this.generate.active || this.edit.active
      if (busy === this.busy) return
      this.busy = busy
      onBusy(busy)
    }
    this.generate = new ImageJob(
      startGenerateJob,
      changed,
      `${keepKey}:imggen:generate`,
    )
    this.edit = new ImageJob(startEditJob, changed, `${keepKey}:imggen:edit`)
  }

  /** Follows again the jobs an earlier visit of the page left running. */
  resume(apiBase: string) {
    this.generate.resume(apiBase)
    this.edit.resume(apiBase)
  }

  /** Stops following both jobs; they keep running on the worker. */
  dispose() {
    this.generate.dispose()
    this.edit.dispose()
    if (this.busy) {
      this.busy = false
      this.onBusy(false)
    }
  }
}

/** A request is being sent, or its job followed. */
export function isRunActive(run: { phase: ImageRunPhase } | null | undefined) {
  return run?.phase === 'starting' || run?.phase === 'running'
}

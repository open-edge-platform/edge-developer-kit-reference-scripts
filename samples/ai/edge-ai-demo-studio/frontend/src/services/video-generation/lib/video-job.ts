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
  startVideo,
  type VideoRequest,
  type VideoStatus,
  videoUrl,
} from './api'

function isFinal({ status }: VideoStatus) {
  return status === 'completed' || status === 'failed' || status === CANCELLED
}

/** Follows the video to the end, then reads its MP4 into an object URL that outlives the worker's copy. */
async function followVideo(
  url: string,
  {
    signal,
    onStatus,
  }: { signal: AbortSignal; onStatus: (status: VideoStatus) => void },
): Promise<{
  status: VideoStatus
  video: string | null
  control: string | null
}> {
  const final = await followStatusEvents<VideoStatus>(`${url}/events`, {
    signal,
    isFinal,
    onStatus,
  })
  if (final.status === 'failed') {
    throw new Error(final.error?.message || 'Video generation failed')
  }
  if (final.status === CANCELLED)
    return { status: final, video: null, control: null }
  const read = async (variant: string) => {
    const res = await fetchOk(`${url}/content?variant=${variant}`, {
      signal,
      errorMessage: 'Failed to read the generated video',
    })
    return URL.createObjectURL(await res.blob())
  }
  const video = await read('video')
  const control = final.pose_to_video ? await read('control') : null
  return { status: final, video, control }
}

function revokePreviews(previews: StepPreview[] | undefined) {
  for (const preview of previews ?? []) URL.revokeObjectURL(preview.url)
}

function revokeResult(result: VideoResult | null | undefined) {
  if (!result) return
  URL.revokeObjectURL(result.video)
  if (result.control) URL.revokeObjectURL(result.control)
  revokePreviews(result.previews)
}

/**
 * `starting` until the worker accepts the video; `lost` when following stopped without an outcome
 * (stream dropped, or the worker forgot it). A lost video is never sent again; `reconnect` follows
 * it again.
 */
export type VideoRunPhase =
  'starting' | 'running' | 'failed' | 'cancelled' | 'lost'

/** What a video is labelled with. */
export interface VideoSettings {
  size: string
  num_frames: number
  num_inference_steps?: number
  imageToVideo: boolean
  poseToVideo?: boolean
}

interface KeptVideoJob {
  settings: VideoSettings
  completed?: boolean
}

/** A denoising step's preview: a small MP4 of the model's guess at the video after that step. */
export interface StepPreview {
  step: number
  /** An object URL, released with the run or result holding it. */
  url: string
}

export interface VideoRun {
  settings: VideoSettings
  /** Sent by an earlier visit of the page and followed again. */
  resumed: boolean
  jobId: string | null
  status: VideoStatus | null
  phase: VideoRunPhase
  error: string | null
  cancelRequested: boolean
  /** The step previews read so far, in step order (a step whose preview failed is left out). */
  previews: StepPreview[]
  /** Denoising steps of the video, once the worker has said. */
  steps: number | null
}

export interface VideoResult {
  /** The MP4 as an object URL, released with the result. */
  video: string
  /** Pose to video: the pose video it followed, as an object URL. */
  control: string | null
  settings: VideoSettings
  /** From the final status. */
  seed: number | null
  fps: number
  seconds: number | null
  /** Asked with previews: every step's but the last, whose result is `video`. */
  previews: StepPreview[]
  steps: number | null
}

export interface VideoJobState {
  /** The request in flight, or the last one if it did not succeed. */
  run: VideoRun | null
  /** The last video made. */
  result: VideoResult | null
}

/** The worker keeps a finished video an hour and forgets all on restart: then 404 / "Job not found". */
function isGone(error: unknown) {
  return (
    isHttpError(error, 404) ||
    (error instanceof Error && error.message === 'Job not found')
  )
}

function followErrorMessage(error: unknown) {
  return isGone(error)
    ? 'The worker no longer has this video: it may have restarted, or the result expired.'
    : getErrorMessage(error, 'Lost the connection to the video')
}

/** A request is being sent, or its video followed. */
export function isRunActive(run: { phase: VideoRunPhase } | null | undefined) {
  return run?.phase === 'starting' || run?.phase === 'running'
}

/**
 * The video requests of one instance. Lives in the demo session, not a component, so a video keeps
 * being followed while another instance is shown. Leaving the page does not cancel it: its id is
 * kept under `keepKey` and the next visit resumes it.
 */
export class VideoJob extends SnapshotStore<VideoJobState> {
  private controller: AbortController | null = null
  private apiBase: string | null = null
  /** Previews of the run followed: the steps asked for so far, read one after another. */
  private previewsAsked = 0
  private previewReads: Promise<void> = Promise.resolve()

  constructor(
    private readonly onBusy: (busy: boolean) => void,
    private readonly keepKey: string,
  ) {
    super({ run: null, result: null })
  }

  get active() {
    return isRunActive(this.snapshot.run)
  }

  submit(apiBase: string, request: VideoRequest) {
    if (this.active) return
    const controller = this.begin()
    this.apiBase = apiBase
    const settings: VideoSettings = {
      size: request.size,
      num_frames: request.num_frames,
      num_inference_steps: request.num_inference_steps,
      imageToVideo: Boolean(request.image) && !request.drivingVideo,
      poseToVideo: Boolean(request.drivingVideo),
    }
    revokePreviews(this.snapshot.run?.previews)
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
        previews: [],
        steps: request.num_inference_steps ?? null,
      },
    })
    // Not aborted with the session: once the answer names the video, a cancel asked for meanwhile
    // cancels it.
    startVideo(apiBase, request).then(
      (started) => {
        const jobId = started.id
        if (controller.signal.aborted) {
          if (jobId) cancelJob(videoUrl(apiBase, jobId))
          return
        }
        if (!jobId) {
          this.end(controller, 'failed', 'No video ID returned from the worker')
          return
        }
        if (this.snapshot.run?.cancelRequested) {
          cancelJob(videoUrl(apiBase, jobId))
        }
        writeKeptJob<KeptVideoJob>(this.keepKey, {
          jobId,
          saved: { settings },
          acceptedAt: Date.now(),
        })
        this.patchRun({ status: started })
        this.follow(apiBase, jobId, controller)
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        this.end(controller, 'failed', getErrorMessage(error, 'Request failed'))
      },
    )
  }

  /** Follows a lost run's video again. The request is not sent again. */
  reconnect(apiBase: string) {
    const run = this.snapshot.run
    if (!run || run.phase !== 'lost' || !run.jobId) return
    this.apiBase = apiBase
    this.follow(apiBase, run.jobId, this.begin())
  }

  /** Follows the video an earlier visit left; a finished one the worker has since forgotten is dropped. */
  resume(apiBase: string) {
    if (this.snapshot.run || this.snapshot.result) return
    const kept = readKeptJob<KeptVideoJob>(this.keepKey)
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
        previews: [],
        steps: kept.saved.settings.num_inference_steps ?? null,
      },
    })
    this.follow(apiBase, kept.jobId, this.begin(), kept.saved.completed)
  }

  /** A queued video is dropped at once, a running one stops before its next network call. */
  cancel() {
    const run = this.snapshot.run
    if (!run || !this.active || run.cancelRequested) return
    this.patchRun({ cancelRequested: true })
    if (run.jobId && this.apiBase) cancelJob(videoUrl(this.apiBase, run.jobId))
  }

  /** Stops following (the video keeps going on the worker, for `resume`) and releases the result. */
  dispose() {
    this.controller?.abort()
    this.controller = null
    revokePreviews(this.snapshot.run?.previews)
    revokeResult(this.snapshot.result)
    this.onBusy(false)
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
    finishedBefore = false,
  ) {
    const url = videoUrl(apiBase, jobId)
    // Following again (a lost run) goes on from the previews already read.
    this.previewsAsked = Math.max(
      0,
      ...(this.snapshot.run?.previews ?? []).map((p) => p.step),
    )
    this.previewReads = Promise.resolve()
    this.patchRun({ jobId, phase: 'running', error: null })
    try {
      const { status, video, control } = await followVideo(url, {
        signal: controller.signal,
        onStatus: (status) => {
          this.patchRun({
            status,
            ...(status.steps && { steps: status.steps }),
          })
          this.readPreviews(url, status.previews ?? 0, controller.signal)
        },
      })
      // The last previews are read before the video is shown, so it comes with all of them.
      await this.previewReads
      // A video that finished on an earlier visit was recorded then.
      if (!finishedBefore) recordJob(apiBase, jobId, status.perf)
      const run = this.snapshot.run
      if (controller.signal.aborted || !video || !run) {
        if (video) URL.revokeObjectURL(video)
        if (control) URL.revokeObjectURL(control)
        if (!controller.signal.aborted) {
          forgetKeptJob(this.keepKey)
          this.end(controller, 'cancelled', null)
        }
        return
      }
      this.controller = null
      writeKeptJob<KeptVideoJob>(this.keepKey, {
        jobId,
        saved: { settings: run.settings, completed: true },
        acceptedAt: Date.now(),
      })
      const previous = this.snapshot.result
      this.update({
        run: null,
        result: {
          video,
          control,
          settings: run.settings,
          seed: status.seed,
          fps: status.fps,
          seconds: Number(status.seconds) || null,
          previews: run.previews,
          steps: run.steps,
        },
      })
      revokeResult(previous)
    } catch (error) {
      if (controller.signal.aborted) return
      if (this.snapshot.run?.status?.status === 'failed') {
        forgetKeptJob(this.keepKey)
        this.end(
          controller,
          'failed',
          getErrorMessage(error, 'The video failed'),
        )
      } else if (finishedBefore && isGone(error)) {
        // A video shown on an earlier visit that has expired since.
        forgetKeptJob(this.keepKey)
        if (this.controller === controller) this.controller = null
        revokePreviews(this.snapshot.run?.previews)
        this.update({ ...this.snapshot, run: null })
      } else {
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
    // A lost run keeps its previews for `reconnect`; the others show none.
    const previews = this.snapshot.run?.previews ?? []
    if (phase !== 'lost') revokePreviews(previews)
    this.patchRun({ phase, error, previews: phase === 'lost' ? previews : [] })
  }

  /** Reads the previews of steps up to `made` not asked for yet, one after another. */
  private readPreviews(url: string, made: number, signal: AbortSignal) {
    while (this.previewsAsked < made) {
      const step = ++this.previewsAsked
      this.previewReads = this.previewReads.then(() =>
        this.readPreview(url, step, signal),
      )
    }
  }

  private async readPreview(url: string, step: number, signal: AbortSignal) {
    if (signal.aborted) return
    let preview: string
    try {
      const res = await fetchOk(`${url}/content?variant=preview&step=${step}`, {
        signal,
        errorMessage: 'Failed to read a step preview',
      })
      preview = URL.createObjectURL(await res.blob())
    } catch {
      // A preview is not worth failing the video for: its step is left out.
      return
    }
    const run = this.snapshot.run
    if (signal.aborted || !run) {
      URL.revokeObjectURL(preview)
      return
    }
    this.patchRun({ previews: [...run.previews, { step, url: preview }] })
  }

  private patchRun(patch: Partial<VideoRun>) {
    const run = this.snapshot.run
    if (!run) return
    this.update({ ...this.snapshot, run: { ...run, ...patch } })
  }

  private update(state: VideoJobState) {
    this.setSnapshot(state)
    this.onBusy(isRunActive(state.run))
  }
}

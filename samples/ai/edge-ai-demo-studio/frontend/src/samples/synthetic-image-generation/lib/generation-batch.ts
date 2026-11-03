// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cancelJob } from '@/lib/browser/sse'
import { getErrorMessage } from '@/lib/errors'
import { SnapshotStore } from '@/services/common/demo/snapshot-store'
import { type JobDefinition, JobRun } from '@/services/common/jobs/job-run'
import { readKeptValue, writeKeptValue } from '@/services/common/jobs/kept-jobs'
import {
  type GeneratedAsset,
  type GenerationRequest,
  type GenerationType,
  generationJob,
  type SyntheticJobStatus,
} from './api'

/** Where one image of a batch is; `failed` ones stay in the gallery for Retry or Remove. */
export type GenerationPhase =
  'submitting' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

/** The parts of a request the gallery labels an image with. */
export interface GenerationSummary {
  type: GenerationType
  customType?: string
  projectName: string
}

export interface GenerationItem {
  /** Its id in the gallery (history images use their URL). */
  id: string
  /** Sent again by Retry; `null` after a reload when the tab's storage could not hold the images. */
  request: GenerationRequest | null
  summary: GenerationSummary
  /** Set once the worker accepted the job. */
  jobId: string | null
  /** When the worker accepted it (epoch ms); jobs are followed in this order, as the worker runs them. */
  acceptedAt: number | null
  phase: GenerationPhase
  /** The worker's latest status, while the job is followed. */
  status: SyntheticJobStatus | null
  error: string | null
  /** Once done. */
  asset: GeneratedAsset | null
  createdAt: number
  /** Cancel was asked for and the job has not stopped yet. */
  cancelling: boolean
}

/** How the latest Generate click went, counted over its images. */
export interface BatchTally {
  total: number
  done: number
  failed: number
  cancelled: number
  /** Still being sent, waiting or generating. */
  active: number
}

export interface GenerationQueueState {
  items: readonly GenerationItem[]
  /** The images of the latest Generate click, by gallery id. */
  batchIds: readonly string[]
}

const SETTLED: readonly GenerationPhase[] = ['done', 'failed', 'cancelled']

export function isSettled(item: GenerationItem): boolean {
  return SETTLED.includes(item.phase)
}

/** The latest batch's images, counted by how they ended. */
export function tallyBatch(state: GenerationQueueState): BatchTally | null {
  if (state.batchIds.length === 0) return null
  const ids = new Set(state.batchIds)
  // `total` still counts images removed since: they were part of the batch.
  const tally: BatchTally = {
    total: state.batchIds.length,
    done: 0,
    failed: 0,
    cancelled: 0,
    active: 0,
  }
  for (const item of state.items) {
    if (!ids.has(item.id)) continue
    if (item.phase === 'done') tally.done++
    else if (item.phase === 'failed') tally.failed++
    else if (item.phase === 'cancelled') tally.cancelled++
    else tally.active++
  }
  return tally
}

let lastLocalId = 0

/** A gallery id for an image this tab generates (history ids are URLs). */
function newLocalId(): string {
  lastLocalId += 1
  return `local-${Date.now().toString(36)}-${lastLocalId}`
}

type StoredItem = Omit<GenerationItem, 'request' | 'status' | 'cancelling'> & {
  /** Its request in `StoredQueue.requests`. */
  requestId?: string
}

/** What a reload brings back: images still in the works, and failed ones. */
interface StoredQueue {
  items: StoredItem[]
  batchIds: string[]
  /** The images' requests (a batch's images share one), dropped when too large for the tab's storage. */
  requests?: Record<string, GenerationRequest>
}

let lastRequestId = 0

/**
 * The images this tab generates on one instance, each its own worker job. A batch's images are
 * submitted one after another (the worker queues them, so they finish if the page goes away), then
 * followed one at a time in accepted order. Lives at module level so navigation returns to it;
 * `sessionStorage` keeps running job ids, failed images and, when they fit, their requests.
 */
export class GenerationQueue extends SnapshotStore<GenerationQueueState> {
  private readonly definition: JobDefinition<
    GenerationRequest,
    SyntheticJobStatus,
    GeneratedAsset
  >
  private readonly storageKey: string
  private followed: {
    id: string
    run: JobRun<GenerationRequest, SyntheticJobStatus, GeneratedAsset>
  } | null = null
  /** Images whose cancel came while they were being sent. */
  private readonly cancelOnAccept = new Set<string>()
  /** Ids of the requests kept for a reload; a batch's images share one. */
  private readonly requestIds = new WeakMap<GenerationRequest, string>()
  /** What was last written for a reload, to skip unchanged writes. */
  private persisted = ''

  constructor(apiBase: string) {
    super({ items: [], batchIds: [] })
    this.definition = generationJob(apiBase)
    this.storageKey = `synthetic-image-generation:${apiBase}`
    this.restore()
  }

  /** Something is being sent, waiting or generating. */
  get active(): boolean {
    return this.snapshot.items.some((item) => !isSettled(item))
  }

  /** Starts following the jobs still in the works, including ones restored after a reload. Idempotent. */
  attach(): void {
    this.pump()
  }

  async generate(request: GenerationRequest, count: number): Promise<void> {
    if (this.active || count < 1) return
    const now = Date.now()
    const added: GenerationItem[] = Array.from({ length: count }, (_, i) => ({
      id: newLocalId(),
      request,
      summary: summarize(request),
      jobId: null,
      acceptedAt: null,
      phase: 'submitting',
      status: null,
      error: null,
      asset: null,
      createdAt: now + i,
      cancelling: false,
    }))
    // Newest first, like the gallery; the batch keeps its own order.
    this.update({
      items: [...added.slice().reverse(), ...this.snapshot.items],
      batchIds: added.map((item) => item.id),
    })
    for (const item of added) {
      // Cancelled while earlier images were being sent: not sent at all.
      if (this.cancelOnAccept.delete(item.id)) {
        this.patch(item.id, { phase: 'cancelled', cancelling: false })
        continue
      }
      await this.submit(item.id, request)
    }
  }

  /** Sends a failed image's request again, as a new job. */
  retry(id: string): void {
    const item = this.find(id)
    if (!item || item.phase !== 'failed' || !item.request) return
    this.patch(id, {
      phase: 'submitting',
      jobId: null,
      acceptedAt: null,
      status: null,
      error: null,
      cancelling: false,
    })
    this.submit(id, item.request)
  }

  /** Takes a failed or cancelled image out of the gallery. */
  remove(id: string): void {
    const item = this.find(id)
    if (!item || !(item.phase === 'failed' || item.phase === 'cancelled')) {
      return
    }
    this.update({
      ...this.snapshot,
      items: this.snapshot.items.filter((other) => other.id !== id),
    })
  }

  /** Forgets a finished image the user deleted from the project. */
  forgetUrl(url: string): void {
    const items = this.snapshot.items.filter(
      (item) => item.asset?.imageUrl !== url,
    )
    if (items.length !== this.snapshot.items.length) {
      this.update({ ...this.snapshot, items })
    }
  }

  /**
   * Cancels every image not made yet: queued ones are dropped at once, the running one stops at its
   * next step without saving, and ones still being sent are cancelled once the worker accepts them.
   */
  cancel(): void {
    for (const item of this.snapshot.items) {
      if (isSettled(item) || item.cancelling) continue
      if (this.followed?.id === item.id) {
        this.followed.run.cancel()
        this.patch(item.id, { cancelling: true })
      } else if (item.jobId) {
        cancelJob(this.definition.jobUrl(item.jobId))
        this.patch(item.id, { phase: 'cancelled', cancelling: false })
      } else {
        this.cancelOnAccept.add(item.id)
        this.patch(item.id, { cancelling: true })
      }
    }
  }

  private async submit(id: string, request: GenerationRequest) {
    let jobId: string
    try {
      jobId = await this.definition.submit(
        request,
        new AbortController().signal,
      )
    } catch (error) {
      this.cancelOnAccept.delete(id)
      if (this.find(id)) {
        this.patch(id, {
          phase: 'failed',
          error: getErrorMessage(error, 'Image generation failed'),
          cancelling: false,
        })
      }
      return
    }
    if (this.cancelOnAccept.delete(id) || !this.find(id)) {
      cancelJob(this.definition.jobUrl(jobId))
      if (this.find(id)) {
        this.patch(id, { jobId, phase: 'cancelled', cancelling: false })
      }
      return
    }
    this.patch(id, { jobId, acceptedAt: Date.now(), phase: 'queued' })
    this.pump()
  }

  /** The next job to follow: the earliest accepted one still in the works. */
  private nextToFollow(): GenerationItem | undefined {
    return this.snapshot.items
      .filter(
        (item) =>
          item.jobId !== null &&
          (item.phase === 'queued' || item.phase === 'running'),
      )
      .sort((a, b) => (a.acceptedAt ?? 0) - (b.acceptedAt ?? 0))[0]
  }

  /** Follows the jobs in the works, one at a time, until none is left. */
  private async pump() {
    if (this.followed) return
    let item = this.nextToFollow()
    while (item?.jobId) {
      const run = new JobRun<
        GenerationRequest,
        SyntheticJobStatus,
        GeneratedAsset
      >(this.definition, null, { jobId: item.jobId })
      const id = item.id
      this.followed = { id, run }
      const unsubscribe = run.subscribe(() => {
        const { status } = run.getSnapshot()
        if (!status || !this.find(id)) return
        this.patch(id, {
          status,
          phase: status.status === 'queued' ? 'queued' : 'running',
        })
      })
      const settled = await run.done
      unsubscribe()
      this.followed = null
      if (this.find(id)) {
        if (settled.phase === 'done' && settled.result) {
          this.patch(id, {
            phase: 'done',
            asset: settled.result,
            status: null,
            cancelling: false,
          })
        } else if (settled.phase === 'failed') {
          this.patch(id, {
            phase: 'failed',
            error: settled.error?.message ?? 'Image generation failed',
            status: null,
            cancelling: false,
          })
        } else {
          this.patch(id, {
            phase: 'cancelled',
            status: null,
            cancelling: false,
          })
        }
      }
      item = this.nextToFollow()
    }
  }

  private find(id: string): GenerationItem | undefined {
    return this.snapshot.items.find((item) => item.id === id)
  }

  private patch(id: string, patch: Partial<GenerationItem>) {
    this.update({
      ...this.snapshot,
      items: this.snapshot.items.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    })
  }

  private update(state: GenerationQueueState) {
    this.setSnapshot(state)
    this.persist()
  }

  private requestId(request: GenerationRequest): string {
    let id = this.requestIds.get(request)
    if (!id) {
      lastRequestId += 1
      id = `r${lastRequestId}`
      this.requestIds.set(request, id)
    }
    return id
  }

  /** Stores what a reload needs, only when it changed: the requests hold whole images. */
  private persist() {
    const kept: StoredItem[] = this.snapshot.items
      .filter((item) => item.phase === 'failed' || !isSettled(item))
      .map(
        ({ request, status: _status, cancelling: _cancelling, ...rest }) => ({
          ...rest,
          requestId: request ? this.requestId(request) : undefined,
        }),
      )
    const signature = JSON.stringify([kept, this.snapshot.batchIds])
    if (signature === this.persisted) return
    this.persisted = signature
    if (kept.length === 0) {
      writeKeptValue(this.storageKey, null)
      return
    }
    const stored: StoredQueue = {
      items: kept,
      batchIds: [...this.snapshot.batchIds],
    }
    const requests: Record<string, GenerationRequest> = {}
    for (const item of this.snapshot.items) {
      if (item.request) requests[this.requestId(item.request)] = item.request
    }
    // The images can be too large for the tab's storage: then only the
    // jobs are kept, and Retry after a reload needs the images again.
    const usedRequests = Object.fromEntries(
      kept.flatMap(({ requestId }) =>
        requestId ? [[requestId, requests[requestId]]] : [],
      ),
    )
    if (
      !writeKeptValue(this.storageKey, { ...stored, requests: usedRequests })
    ) {
      writeKeptValue(this.storageKey, stored)
    }
  }

  private restore() {
    const stored = readKeptValue<StoredQueue>(this.storageKey)
    if (!stored || !Array.isArray(stored.items)) return
    const items: GenerationItem[] = stored.items.map(
      ({ requestId, ...item }) => {
        const request =
          (requestId ? stored.requests?.[requestId] : undefined) ?? null
        const base: GenerationItem = {
          ...item,
          request,
          status: null,
          cancelling: false,
        }
        if (isSettled(base)) return base
        // Its upload was cut off by the reload: no job was made.
        if (!item.jobId) {
          return {
            ...base,
            phase: 'failed',
            error: 'The page reloaded before the worker accepted this image.',
          }
        }
        return { ...base, phase: 'queued' }
      },
    )
    this.setSnapshot({
      items,
      batchIds: Array.isArray(stored.batchIds) ? stored.batchIds : [],
    })
  }
}

function summarize(request: GenerationRequest): GenerationSummary {
  return {
    type: request.type,
    customType: request.customType || undefined,
    projectName: request.projectName,
  }
}

/** One queue per instance, for the life of the tab. */
const queues = new Map<string, GenerationQueue>()

/** The queue of the instance at `apiBase`, created on first use; nothing runs until `attach`. */
export function generationQueue(apiBase: string): GenerationQueue {
  let queue = queues.get(apiBase)
  if (!queue) {
    queue = new GenerationQueue(apiBase)
    queues.set(apiBase, queue)
  }
  return queue
}

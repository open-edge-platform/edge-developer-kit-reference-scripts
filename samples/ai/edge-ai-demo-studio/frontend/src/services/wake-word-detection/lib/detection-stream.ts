// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { fetchOk } from '@/lib/browser/fetch-json'
import { readSseJson } from '@/lib/browser/sse'
import { SnapshotStore } from '@/services/common/demo/snapshot-store'
import { wakeWordV1Base } from './api'

export interface DetectionEvent {
  event: string
  model: string
  score: number
  timestamp: string
  message: string
}

export interface AudioLevel {
  level: number
  active: boolean
}

export interface StreamSnapshot {
  /** Newest first, as the worker lists them. */
  events: DetectionEvent[]
  level: AudioLevel
}

const MAX_EVENTS = 200
const RETRY_MIN_MS = 1_000
const RETRY_MAX_MS = 10_000

export const IDLE_LEVEL: AudioLevel = { level: 0, active: false }

/** One detection's identity: the worker stamps each with its time and model. */
const eventKey = (e: DetectionEvent) => `${e.timestamp}-${e.model}`

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

/**
 * One instance's `GET /events/stream` (detections and input level), one connection shared by every
 * hook: open while retained, reopened when it drops. Events seen stay after it closes.
 */
class DetectionStream extends SnapshotStore<StreamSnapshot> {
  private readonly apiBase: string
  private readonly detectionListeners = new Set<
    (event: DetectionEvent) => void
  >()
  private holds = 0
  private controller: AbortController | null = null

  constructor(apiBase: string) {
    super({ events: [], level: IDLE_LEVEL })
    this.apiBase = apiBase
  }

  /** Calls `listener` for each detection as it arrives — never for stored ones. */
  onDetection(listener: (event: DetectionEvent) => void): () => void {
    this.detectionListeners.add(listener)
    return () => {
      this.detectionListeners.delete(listener)
    }
  }

  /** Keeps the connection open until the returned release is called. */
  retain(): () => void {
    this.holds += 1
    if (this.holds === 1) this.open()
    let released = false
    return () => {
      if (released) return
      released = true
      this.holds -= 1
      if (this.holds === 0) this.close()
    }
  }

  clearEvents() {
    this.update({ events: [] })
  }

  private update(patch: Partial<StreamSnapshot>) {
    this.patchSnapshot(patch)
  }

  private open() {
    const controller = new AbortController()
    this.controller = controller
    this.run(controller.signal)
  }

  private close() {
    this.controller?.abort()
    this.controller = null
    this.update({ level: IDLE_LEVEL })
  }

  private async run(signal: AbortSignal) {
    let delay = RETRY_MIN_MS
    while (!signal.aborted) {
      try {
        const res = await fetchOk(
          `${wakeWordV1Base(this.apiBase)}/events/stream`,
          { signal, headers: { Accept: 'text/event-stream' } },
        )
        if (!res.body) throw new Error('The event stream has no body')
        for await (const { event, data } of readSseJson(res.body)) {
          delay = RETRY_MIN_MS
          this.handle(event, data)
        }
      } catch {
        // Reconnected below; a stopped or restarting worker drops the stream.
      }
      if (signal.aborted) return
      if (this.snapshot.level !== IDLE_LEVEL) this.update({ level: IDLE_LEVEL })
      await sleep(delay, signal)
      delay = Math.min(delay * 2, RETRY_MAX_MS)
    }
  }

  private handle(event: string, data: unknown) {
    if (event === 'events') {
      // Everything the worker has buffered: sent on every (re)connect, so
      // detections made while the stream was down show up too.
      const incoming = (data as { events?: DetectionEvent[] }).events ?? []
      const known = new Set(this.snapshot.events.map(eventKey))
      const missed = incoming.filter((e) => !known.has(eventKey(e)))
      if (missed.length === 0) return
      const events = [...missed, ...this.snapshot.events]
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, MAX_EVENTS)
      this.update({ events })
    } else if (event === 'detection') {
      const detection = data as DetectionEvent
      const key = eventKey(detection)
      if (this.snapshot.events.some((e) => eventKey(e) === key)) return
      this.update({
        events: [detection, ...this.snapshot.events].slice(0, MAX_EVENTS),
      })
      for (const listener of this.detectionListeners) listener(detection)
    } else if (event === 'cleared') {
      this.update({ events: [] })
    } else if (event === 'level') {
      const { level, active } = data as AudioLevel
      const current = this.snapshot.level
      if (current.level === level && current.active === active) return
      this.update({ level: { level, active } })
    }
  }
}

const streams = new Map<string, DetectionStream>()

/** The shared stream of the instance at `apiBase`. */
export function detectionStream(apiBase: string): DetectionStream {
  let stream = streams.get(apiBase)
  if (!stream) {
    stream = new DetectionStream(apiBase)
    streams.set(apiBase, stream)
  }
  return stream
}

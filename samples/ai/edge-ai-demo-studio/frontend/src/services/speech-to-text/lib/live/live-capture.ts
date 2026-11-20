// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { loadPcmWorklet, PCM_WORKLET, SAMPLE_RATE } from './pcm-worklet'

export interface CaptureSubscription {
  unsubscribe: () => void
  /** `performance.now()` at the subscriber's first sample; `null` until the capture starts. */
  startedAt: () => number | null
}

/**
 * Audio held before `start()`, seconds: longer than the sessions take to open, so speech while
 * they connect still reaches the workers. Older audio is dropped.
 */
const MAX_PENDING_SECONDS = 10

/**
 * The microphone as 16 kHz mono int16 PCM frames, for one or more live sessions. Frames are
 * captured from `open()` on but held until `start()`, which replays them to every session
 * subscribed by then: they all stream the same samples on the same timeline (workers running the
 * same VAD cut the same utterances from them), and speech while their sockets opened is not lost.
 * One subscribing later begins at the next frame, its `startedAt` counting the samples it missed.
 *
 * Reference-counted: `open()` hands its caller one reference, each session takes another with
 * `acquire()`, and the microphone is released with the last `release()`.
 */
export class LiveCapture {
  readonly stream: MediaStream
  private readonly audioCtx: AudioContext
  private readonly source: MediaStreamAudioSourceNode
  private readonly node: AudioWorkletNode
  private readonly moduleUrl: string
  private readonly listeners = new Set<(pcm: ArrayBuffer) => void>()
  private refs = 1
  /** `performance.now()` at the first sample posted. */
  private readonly capturedAt: number
  /** Samples posted since `open()`. */
  private samples = 0
  /** Frames posted before `start()`, the oldest dropped past `MAX_PENDING_SECONDS`. */
  private pending: ArrayBuffer[] = []
  private pendingSamples = 0
  /** The first sample `start()` replayed; `null` until then. */
  private firstStreamed: number | null = null

  private constructor(
    stream: MediaStream,
    audioCtx: AudioContext,
    moduleUrl: string,
  ) {
    this.stream = stream
    this.audioCtx = audioCtx
    this.moduleUrl = moduleUrl
    this.source = audioCtx.createMediaStreamSource(stream)
    this.node = new AudioWorkletNode(audioCtx, PCM_WORKLET)
    this.node.port.onmessage = (event: MessageEvent<ArrayBuffer>) =>
      this.receive(event.data)
    this.source.connect(this.node)
    // Connected so the worklet keeps processing; it outputs nothing, so nothing plays back.
    this.node.connect(this.audioCtx.destination)
    this.capturedAt = performance.now()
  }

  /** Opens the microphone and loads the worklet; rejects holding nothing. */
  static async open(): Promise<LiveCapture> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1 },
    })
    let audioCtx: AudioContext | null = null
    let moduleUrl: string | null = null
    try {
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      audioCtx = new AudioCtx({ sampleRate: SAMPLE_RATE })
      moduleUrl = await loadPcmWorklet(audioCtx)
      return new LiveCapture(stream, audioCtx, moduleUrl)
    } catch (error) {
      for (const track of stream.getTracks()) track.stop()
      audioCtx?.close().catch(() => {})
      if (moduleUrl) URL.revokeObjectURL(moduleUrl)
      throw error
    }
  }

  /** Takes a reference; throws once the capture has been released. */
  acquire() {
    if (this.refs === 0) throw new Error('The microphone capture has ended')
    this.refs += 1
  }

  release() {
    if (this.refs === 0) return
    this.refs -= 1
    if (this.refs === 0) this.close()
  }

  /**
   * Streams the frames: the ones held since `open()` at once, then each as it comes (once; not
   * after the capture is released).
   */
  start() {
    if (this.firstStreamed !== null || this.refs === 0) return
    this.firstStreamed = this.samples - this.pendingSamples
    const held = this.pending
    this.pending = []
    this.pendingSamples = 0
    for (const pcm of held) {
      for (const listener of this.listeners) listener(pcm)
    }
  }

  /** Each frame from the next one on; before `start()`, from the first it replays. */
  subscribe(listener: (pcm: ArrayBuffer) => void): CaptureSubscription {
    // Late: at the next frame. Early: wherever `start()` begins, known only then.
    const late = this.firstStreamed !== null ? this.samples : null
    this.listeners.add(listener)
    return {
      unsubscribe: () => {
        this.listeners.delete(listener)
      },
      startedAt: () => {
        const firstSample = late ?? this.firstStreamed
        return firstSample === null
          ? null
          : this.capturedAt + (firstSample / SAMPLE_RATE) * 1000
      },
    }
  }

  private receive(pcm: ArrayBuffer) {
    this.samples += pcm.byteLength / 2
    if (this.firstStreamed !== null) {
      for (const listener of this.listeners) listener(pcm)
      return
    }
    this.pending.push(pcm)
    this.pendingSamples += pcm.byteLength / 2
    while (this.pendingSamples > MAX_PENDING_SECONDS * SAMPLE_RATE) {
      const dropped = this.pending.shift()
      if (!dropped) break
      this.pendingSamples -= dropped.byteLength / 2
    }
  }

  private close() {
    this.pending = []
    this.pendingSamples = 0
    this.listeners.clear()
    this.node.port.onmessage = null
    try {
      this.node.disconnect()
      this.source.disconnect()
    } catch {
      // nodes may already be disconnected
    }
    for (const track of this.stream.getTracks()) track.stop()
    if (this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {})
    }
    URL.revokeObjectURL(this.moduleUrl)
  }
}

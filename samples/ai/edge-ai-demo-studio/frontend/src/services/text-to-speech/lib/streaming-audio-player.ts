// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Plays audio piece by piece as it arrives. Pieces are scheduled on the Web Audio clock back to
 * back, so timely ones join gaplessly; a late piece starts shortly after arriving. Create the
 * player in a click handler: an `AudioContext` only makes sound after a user gesture.
 */

/** Lead time before a piece that starts playback (or restarts it after a stall). */
const START_DELAY_SECONDS = 0.05

interface Segment {
  /** Audio-clock time the piece starts at. */
  start: number
  /** Seconds of audio before this piece. */
  offset: number
  duration: number
}

export class StreamingAudioPlayer {
  private readonly context = new AudioContext()
  private readonly sources = new Set<AudioBufferSourceNode>()
  private readonly segments: Segment[] = []
  /** Index of the segment playing at the last position read. */
  private playing = 0
  private nextStart = 0
  private scheduled = 0
  private finished = false
  private closed = false
  private readonly onEnded?: () => void

  constructor({ onEnded }: { onEnded?: () => void } = {}) {
    this.onEnded = onEnded
  }

  /** Seconds of audio handed over so far. */
  get duration(): number {
    return this.scheduled
  }

  /** Seconds of audio played so far. */
  get currentTime(): number {
    if (this.closed) return this.scheduled
    const now = this.context.currentTime
    while (this.playing < this.segments.length) {
      const segment = this.segments[this.playing]
      if (now < segment.start + segment.duration) {
        return segment.offset + Math.max(0, now - segment.start)
      }
      this.playing += 1
    }
    return this.scheduled
  }

  enqueue(channels: Float32Array<ArrayBuffer>[], sampleRate: number): void {
    const length = channels[0]?.length ?? 0
    if (this.closed || length === 0) return
    const buffer = this.context.createBuffer(
      channels.length,
      length,
      sampleRate,
    )
    channels.forEach((samples, channel) =>
      buffer.copyToChannel(samples, channel),
    )
    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.connect(this.context.destination)
    const start = Math.max(
      this.nextStart,
      this.context.currentTime + START_DELAY_SECONDS,
    )
    source.onended = () => {
      this.sources.delete(source)
      this.endIfDone()
    }
    source.start(start)
    this.sources.add(source)
    this.segments.push({
      start,
      offset: this.scheduled,
      duration: buffer.duration,
    })
    this.nextStart = start + buffer.duration
    this.scheduled += buffer.duration
  }

  /** No more pieces; `onEnded` fires once the last has played. */
  finish(): void {
    this.finished = true
    this.endIfDone()
  }

  pause(): Promise<void> {
    return this.closed ? Promise.resolve() : this.context.suspend()
  }

  resume(): Promise<void> {
    return this.closed ? Promise.resolve() : this.context.resume()
  }

  /** Stops playback for good and releases the audio device. */
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const source of this.sources) {
      source.onended = null
      source.stop()
    }
    this.sources.clear()
    this.context.close().catch(() => {})
  }

  private endIfDone(): void {
    if (!this.finished || this.closed || this.sources.size > 0) return
    this.close()
    this.onEnded?.()
  }
}

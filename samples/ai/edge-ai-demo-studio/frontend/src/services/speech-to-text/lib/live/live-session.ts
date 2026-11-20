// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { logger } from '@/lib/logger'
import { type CaptureSubscription, LiveCapture } from './live-capture'
import type {
  LiveProtocol,
  LiveProtocolFactory,
  ProtocolContext,
  VoiceActivity,
} from './protocol'

// How long to wait for the worker to flush its final utterance after stop.
const FLUSH_TIMEOUT_MS = 15000

export interface LiveStartOptions {
  /**
   * What the socket speaks, and what it is asked for: `sttProtocol` for transcription,
   * `diarizationStreamProtocol` for speakers. Its context's `timeOffset` puts its times on the
   * reference timeline.
   */
  protocol: LiveProtocolFactory
  /**
   * A microphone capture shared with other sessions, so every worker gets the same samples on one
   * timeline. Its owner starts it once the sessions have opened. Unset, the session opens its own
   * and starts it when its socket is ready.
   */
  capture?: LiveCapture
  /** Not called once `stop`, `dispose` or a disconnect has ended listening. */
  onVoiceActivity?: (activity: VoiceActivity) => void
  onError?: (message: string) => void
  /** The worker closed the socket unasked; capture is already released, nothing left to flush. */
  onDisconnect?: (message: string) => void
  /**
   * `performance.now()` at t=0 of a reference recording. Live capture starts slightly after
   * `MediaRecorder`, so timestamps are shifted by the difference to line up with batch segments.
   */
  timeOrigin?: number
  /** Logs per-utterance perceived latency (on OVMS also the worker's `[latency]` accounting). */
  latencyLog?: boolean
}

export interface LiveTarget {
  port: number | undefined
  /** Records an utterance for the instance's Live metrics. */
  measured: ProtocolContext['measured']
  /** The microphone stream while it is open, then `null`. */
  onCapture: (stream: MediaStream | null) => void
}

function closeMessage(event: CloseEvent): string {
  if (event.reason) return `The worker ended the live session: ${event.reason}`
  // 1006: no close frame at all — the connection was lost.
  if (event.code === 1006) return 'The live connection to the worker was lost'
  return `The worker ended the live session (code ${event.code})`
}

const CANCELLED_MESSAGE = 'The live session was stopped before it started'

/** A session stopped or disposed while starting: nothing failed, nothing to report. */
export function isLiveSessionCancelled(error: unknown): boolean {
  return error instanceof Error && error.message === CANCELLED_MESSAGE
}

function opened(ws: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.addEventListener('error', () => reject(new Error('WebSocket failed')), {
      once: true,
    })
  })
}

/**
 * One-shot live session: the microphone's 16 kHz PCM (`LiveCapture`) streamed over the given
 * protocol. `stop()` flushes the last utterance, `dispose()` drops everything.
 * If either comes while `open()` still waits, `open()` releases what it holds and rejects.
 */
export class LiveSession {
  private ws: WebSocket | null = null
  private capture: LiveCapture | null = null
  /** Kept after the capture is released: the final utterances still need its timeline. */
  private subscription: CaptureSubscription | null = null
  private stopMessage: string | null = null
  private streaming = false
  /** `stop()` or `dispose()` was called: nothing new may start. */
  private ended = false
  /** Resolves `stop()` once the worker has closed the socket after the flush. */
  private onFlushed: (() => void) | null = null
  /** Gives up on a flush the worker never confirms. */
  private flushTimer: ReturnType<typeof setTimeout> | undefined

  private readonly options: LiveStartOptions
  private readonly target: LiveTarget

  constructor(options: LiveStartOptions, target: LiveTarget) {
    this.options = options
    this.target = target
  }

  /** Rejects, holding nothing, when the mic or socket can't open or the session was stopped first. */
  async open(): Promise<void> {
    const {
      protocol: protocolFor,
      onVoiceActivity,
      onError,
      onDisconnect,
      timeOrigin,
      latencyLog = false,
    } = this.options
    // The WebSocket bypasses the HTTP proxy and connects to the worker port directly.
    const port = this.target.port
    if (!port) throw new Error('The worker is not running')

    const tStart = performance.now()
    const shared = this.options.capture
    // `performance.now()` at this session's first sample, once its capture has started.
    const sessionStart = () => this.subscription?.startedAt() ?? null
    try {
      // Held before any wait, so the owner may start or release it meanwhile.
      if (shared) {
        shared.acquire()
        this.capture = shared
      } else {
        const own = await LiveCapture.open()
        this.capture = own
        if (this.ended) throw new Error(CANCELLED_MESSAGE)
      }
      const capture = this.capture
      this.target.onCapture(capture.stream)

      const ctx: ProtocolContext = {
        latencyLog,
        elapsed: () => {
          const start = sessionStart()
          return start === null ? 0 : (performance.now() - start) / 1000
        },
        timeOffset: () => {
          const start = sessionStart()
          return start === null || timeOrigin == null
            ? 0
            : (start - timeOrigin) / 1000
        },
        voice: (activity) => {
          if (this.streaming) onVoiceActivity?.(activity)
        },
        measured: this.target.measured,
        onError,
      }
      const protocol: LiveProtocol = protocolFor(ctx)
      this.stopMessage = protocol.stopMessage

      // Resolving "localhost" costs an extra lookup (and an IPv6-first attempt) per connection.
      const host =
        window.location.hostname === 'localhost'
          ? '127.0.0.1'
          : window.location.hostname
      const url = new URL(
        `ws://${host}:${port}${protocol.path}?${protocol.params.toString()}`,
      )
      const ws = new WebSocket(url.toString())
      if (protocol.binary) ws.binaryType = 'arraybuffer'
      this.ws = ws

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        protocol.handleMessage(event.data, ws)
      }
      ws.onerror = () => {
        logger.warn('Live stream socket error')
      }
      ws.onclose = (event) => {
        if (this.ws === ws) this.ws = null
        const flushed = this.onFlushed
        this.onFlushed = null
        if (flushed) {
          flushed()
          return
        }
        if (!this.streaming || this.ended) return
        // The worker went away mid-session: nothing else would release the mic or tell the caller.
        const message = closeMessage(event)
        logger.warn('Live stream closed by the worker:', message)
        this.ended = true
        this.releaseCapture()
        onDisconnect?.(message)
      }

      await opened(ws)
      if (this.ended) throw new Error(CANCELLED_MESSAGE)
      for (const message of protocol.openMessages) ws.send(message)
      logger.debug(
        `[latency] stream socket open in ${Math.round(performance.now() - tStart)}ms`,
      )

      this.subscription = capture.subscribe((pcm) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(protocol.encodeFrame(pcm))
      })
      if (!shared) capture.start()

      this.streaming = true
      logger.debug(
        `[latency] capture pipeline ready in ${Math.round(
          performance.now() - tStart,
        )}ms on ${protocol.path}${shared ? ' (shared capture)' : ''}`,
      )
    } catch (error) {
      this.releaseCapture()
      this.closeSocket()
      throw this.ended ? new Error(CANCELLED_MESSAGE) : error
    }
  }

  /** Resolves once the worker has transcribed the final utterance and closed the socket. */
  stop(): Promise<void> {
    const ws = this.ws
    const wasStreaming = this.streaming
    this.ended = true
    this.streaming = false
    this.releaseCapture()
    if (
      !wasStreaming ||
      !ws ||
      ws.readyState !== WebSocket.OPEN ||
      !this.stopMessage
    ) {
      this.closeSocket()
      return Promise.resolve()
    }
    const stopMessage = this.stopMessage
    return new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(this.flushTimer)
        this.flushTimer = undefined
        this.onFlushed = null
        resolve()
      }
      this.onFlushed = finish
      try {
        // The worker transcribes the buffered speech, then closes the socket, which calls `finish`.
        ws.send(stopMessage)
      } catch {
        finish()
        return
      }
      // Never block on a stuck worker.
      this.flushTimer = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) ws.close()
        if (this.ws === ws) this.ws = null
        finish()
      }, FLUSH_TIMEOUT_MS)
    })
  }

  /** Ends capture, socket and any awaited flush at once. */
  dispose() {
    this.ended = true
    this.streaming = false
    this.releaseCapture()
    const flushed = this.onFlushed
    this.onFlushed = null
    flushed?.()
    this.closeSocket()
  }

  /** Stops sending audio; the microphone closes with the capture's last reference. */
  private releaseCapture() {
    this.subscription?.unsubscribe()
    if (this.capture) {
      this.capture.release()
      this.capture = null
      this.target.onCapture(null)
    }
  }

  private closeSocket() {
    const ws = this.ws
    this.ws = null
    if (
      ws &&
      (ws.readyState === WebSocket.CONNECTING ||
        ws.readyState === WebSocket.OPEN)
    ) {
      ws.close()
    }
  }
}

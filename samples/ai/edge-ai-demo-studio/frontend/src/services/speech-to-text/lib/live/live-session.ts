// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { logger } from '@/lib/logger'
import type { SttBackendId } from '../../config'
import { audioStreamProtocol } from './audio-stream-protocol'
import { loadPcmWorklet, PCM_WORKLET, SAMPLE_RATE } from './pcm-worklet'
import type {
  LiveProtocol,
  LiveTranscript,
  LiveVadSettings,
  ProtocolContext,
  VoiceActivity,
} from './protocol'
import { realtimeProtocol } from './realtime-protocol'

// How long to wait for the worker to flush its final utterance after stop.
const FLUSH_TIMEOUT_MS = 15000

export interface LiveStartOptions {
  language: string
  /** `oep` streams over `/v1/realtime` (JSON events), `ovms` over `/v1/audio/stream` (raw PCM). */
  backend: SttBackendId
  /** Unset keeps the worker's VAD settings. */
  vad?: LiveVadSettings
  onTranscript?: (transcript: LiveTranscript) => void
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
 * One-shot live transcription: mic captured as 16 kHz PCM via an AudioWorklet and streamed over
 * either backend's protocol. `stop()` flushes the last utterance, `dispose()` drops everything.
 * If either comes while `open()` still waits, `open()` releases what it holds and rejects.
 */
export class LiveSession {
  private ws: WebSocket | null = null
  private audioCtx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private stream: MediaStream | null = null
  private moduleUrl: string | null = null
  private stopMessage: string | null = null
  private captureStart = 0
  // Offset from capture time to the reference recording timeline, seconds.
  private timeOffset = 0
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
      language,
      backend,
      vad,
      onTranscript,
      onVoiceActivity,
      onError,
      onDisconnect,
      timeOrigin,
      latencyLog = false,
    } = this.options
    // The WebSocket bypasses the HTTP proxy and connects to the worker port directly.
    const port = this.target.port
    if (!port) throw new Error('Speech to Text is not running')

    const tStart = performance.now()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1 },
      })
      if (this.ended) {
        for (const track of stream.getTracks()) track.stop()
        throw new Error(CANCELLED_MESSAGE)
      }
      this.stream = stream
      this.target.onCapture(stream)

      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      const audioCtx = new AudioCtx({ sampleRate: SAMPLE_RATE })
      this.audioCtx = audioCtx

      const ctx: ProtocolContext = {
        language,
        vad,
        latencyLog,
        elapsed: () => (performance.now() - this.captureStart) / 1000,
        timeOffset: () => this.timeOffset,
        emit: (transcript) => onTranscript?.(transcript),
        voice: (activity) => {
          if (this.streaming) onVoiceActivity?.(activity)
        },
        measured: this.target.measured,
        onError,
      }
      const protocol: LiveProtocol =
        backend === 'ovms' ? audioStreamProtocol(ctx) : realtimeProtocol(ctx)
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

      this.moduleUrl = await loadPcmWorklet(audioCtx)
      if (this.ended) throw new Error(CANCELLED_MESSAGE)
      if (ws.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket closed before capture started')
      }

      const source = audioCtx.createMediaStreamSource(stream)
      this.source = source
      const node = new AudioWorkletNode(audioCtx, PCM_WORKLET)
      this.node = node

      node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (ws.readyState !== WebSocket.OPEN) return
        ws.send(protocol.encodeFrame(event.data))
      }

      source.connect(node)
      // Connected so the worklet keeps processing; it outputs nothing, so nothing plays back.
      node.connect(audioCtx.destination)
    } catch (error) {
      this.releaseCapture()
      this.closeSocket()
      throw this.ended ? new Error(CANCELLED_MESSAGE) : error
    }

    this.streaming = true
    this.captureStart = performance.now()
    this.timeOffset =
      timeOrigin != null ? (this.captureStart - timeOrigin) / 1000 : 0
    logger.debug(
      `[latency] capture pipeline ready in ${Math.round(
        this.captureStart - tStart,
      )}ms on ${backend}, timeline offset ${Math.round(
        this.timeOffset * 1000,
      )}ms`,
    )
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

  private releaseCapture() {
    try {
      this.node?.disconnect()
      this.source?.disconnect()
    } catch {
      // nodes may already be disconnected
    }
    this.node = null
    this.source = null

    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop()
      this.stream = null
      this.target.onCapture(null)
    }

    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {})
    }
    this.audioCtx = null

    if (this.moduleUrl) {
      URL.revokeObjectURL(this.moduleUrl)
      this.moduleUrl = null
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

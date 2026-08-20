// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback, useRef } from 'react'
import { logger } from '@/lib/logger'
import { service as sttService } from '@/services/speech-to-text/data'

export interface LiveTranscript {
  text: string
  start: number // seconds, relative to capture start (adjusted for timeline offset)
  end: number // seconds
}

/** Per-stage timings reported by the gateway for a transcribed utterance, in ms. */
interface TranscriptLatency {
  endpoint_ms: number
  queue_ms: number
  stt_ms: number
  e2e_ms: number
}

interface StartOptions {
  language: string
  onTranscript?: (transcript: LiveTranscript) => void
  onError?: (message: string) => void
  /**
   * `performance.now()` value marking t=0 of the reference recording. Live
   * capture starts slightly after `MediaRecorder`, so emitted timestamps are
   * shifted by the difference to keep both on one timeline — without this,
   * batch and live segments do not line up.
   */
  timeOrigin?: number
  /**
   * Enables the worker's per-utterance `[latency]` accounting and the
   * matching client-side `[latency]` console logs. Off by default.
   */
  latencyLog?: boolean
}

// Emitted at 16 kHz, mono. Buffered to ~50 ms chunks before sending: small
// enough that frames never sit around waiting to be filled (which would add
// straight onto the perceived latency), large enough to keep the WebSocket
// message rate modest.
const FRAME_SAMPLES = 800

// How long to wait for the worker to flush its final utterance after stop.
const FLUSH_TIMEOUT_MS = 15000

const WORKLET_CODE = `
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buffer = new Int16Array(${FRAME_SAMPLES})
    this._offset = 0
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        let sample = Math.max(-1, Math.min(1, channel[i]))
        this._buffer[this._offset++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
        if (this._offset === this._buffer.length) {
          this.port.postMessage(this._buffer.buffer.slice(0))
          this._offset = 0
        }
      }
    }
    return true
  }
}
registerProcessor('pcm-worklet', PcmWorklet)
`

/**
 * Streams live microphone PCM to the speech-to-text worker's live audio
 * stream endpoint over a WebSocket and invokes `onTranscript` as each
 * incremental utterance is transcribed.
 *
 * This is best-effort: if the worker is unavailable, `start` throws and the
 * caller can fall back to batch processing on stop.
 */
export function useLiveStream() {
  const wsRef = useRef<WebSocket | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const nodeRef = useRef<AudioWorkletNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const moduleUrlRef = useRef<string | null>(null)
  // Latency instrumentation.
  const captureStartRef = useRef(0)
  const transcriptCountRef = useRef(0)
  const latencyLogRef = useRef(false)
  // Offset from live-capture time to the reference recording timeline, seconds.
  const timeOffsetRef = useRef(0)
  // Resolved when the worker reports it has flushed the final utterance.
  const flushedRef = useRef<(() => void) | null>(null)

  const cleanup = useCallback(() => {
    try {
      nodeRef.current?.disconnect()
      sourceRef.current?.disconnect()
    } catch {
      // nodes may already be disconnected
    }
    nodeRef.current = null
    sourceRef.current = null

    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null

    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {})
    }
    audioCtxRef.current = null

    if (moduleUrlRef.current) {
      URL.revokeObjectURL(moduleUrlRef.current)
      moduleUrlRef.current = null
    }
  }, [])

  const start = useCallback(
    async ({
      language,
      onTranscript,
      onError,
      timeOrigin,
      latencyLog = false,
    }: StartOptions) => {
      transcriptCountRef.current = 0
      timeOffsetRef.current = 0
      flushedRef.current = null
      latencyLogRef.current = latencyLog
      const tStart = performance.now()
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1 },
      })
      streamRef.current = stream

      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      const audioCtx = new AudioCtx({ sampleRate: 16000 })
      audioCtxRef.current = audioCtx

      const port = sttService.port
      // Prefer the literal loopback IP: resolving "localhost" costs an extra
      // lookup (and an IPv6-first attempt) on every connection.
      const host =
        window.location.hostname === 'localhost'
          ? '127.0.0.1'
          : window.location.hostname
      const params = new URLSearchParams({ language })
      if (latencyLog) params.set('latency_log', 'true')
      const url = new URL(
        `ws://${host}:${port}/v1/audio/stream?${params.toString()}`,
      )
      const ws = new WebSocket(url.toString())
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string)
          if (data.type === 'transcript') {
            transcriptCountRef.current += 1

            if (latencyLogRef.current && data.latency) {
              const latency = data.latency as TranscriptLatency | undefined
              // Perceived latency: from the end of the spoken audio (in capture
              // time) to the transcript actually reaching the UI.
              const perceivedMs =
                performance.now() - captureStartRef.current - data.end * 1000
              logger.info(
                `[latency] live transcript #${transcriptCountRef.current}: ` +
                  `perceived=${Math.round(perceivedMs)}ms ` +
                  `endpoint=${latency?.endpoint_ms ?? '?'}ms ` +
                  `queue=${latency?.queue_ms ?? '?'}ms ` +
                  `stt=${latency?.stt_ms ?? '?'}ms ` +
                  `worker_e2e=${latency?.e2e_ms ?? '?'}ms ` +
                  `audio=${(data.end - data.start).toFixed(2)}s ` +
                  `chars=${String(data.text ?? '').length}`,
              )
            }

            onTranscript?.({
              text: data.text,
              start: data.start + timeOffsetRef.current,
              end: data.end + timeOffsetRef.current,
            })
          } else if (data.type === 'speech_start') {
            logger.debug(
              `[latency] speech detected at +${Math.round(
                performance.now() - captureStartRef.current,
              )}ms`,
            )
          } else if (data.type === 'done') {
            // Worker drained the final utterance; no need to keep waiting.
            ws.close()
            wsRef.current = null
            flushedRef.current?.()
            flushedRef.current = null
          } else if (data.type === 'error') {
            logger.warn('Live stream error:', data.message)
            onError?.(data.message)
          }
        } catch {
          // ignore malformed messages
        }
      }
      ws.onerror = () => {
        logger.warn('Live stream socket error')
      }

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve()
        ws.addEventListener(
          'error',
          () => reject(new Error('WebSocket failed')),
          {
            once: true,
          },
        )
      })
      logger.debug(
        `[latency] stream socket open in ${Math.round(performance.now() - tStart)}ms`,
      )

      const moduleUrl = URL.createObjectURL(
        new Blob([WORKLET_CODE], { type: 'application/javascript' }),
      )
      moduleUrlRef.current = moduleUrl
      await audioCtx.audioWorklet.addModule(moduleUrl)

      const source = audioCtx.createMediaStreamSource(stream)
      sourceRef.current = source
      const node = new AudioWorkletNode(audioCtx, 'pcm-worklet')
      nodeRef.current = node

      node.port.onmessage = (event) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(event.data as ArrayBuffer)
        }
      }

      source.connect(node)
      // Connect to the destination so the worklet keeps processing; the node
      // produces no output, so nothing is played back.
      node.connect(audioCtx.destination)
      captureStartRef.current = performance.now()
      timeOffsetRef.current =
        timeOrigin != null ? (captureStartRef.current - timeOrigin) / 1000 : 0
      logger.debug(
        `[latency] capture pipeline ready in ${Math.round(
          captureStartRef.current - tStart,
        )}ms, timeline offset ${Math.round(timeOffsetRef.current * 1000)}ms`,
      )
    },
    [],
  )

  /**
   * Stops capture and resolves once the worker has finished processing the
   * final pending utterance(s), so the caller can safely consume the
   * collected results. Resolves immediately when no socket is open.
   */
  const stop = useCallback((): Promise<void> => {
    const ws = wsRef.current
    cleanup()
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      wsRef.current = null
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        flushedRef.current = null
        resolve()
      }
      flushedRef.current = finish
      try {
        ws.send(JSON.stringify({ event: 'stop' }))
      } catch {
        finish()
        return
      }
      ws.addEventListener('close', finish, { once: true })
      // Safety net: never block the batch pipeline on a stuck worker.
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) ws.close()
        wsRef.current = null
        finish()
      }, FLUSH_TIMEOUT_MS)
    })
  }, [cleanup])

  return { start, stop }
}

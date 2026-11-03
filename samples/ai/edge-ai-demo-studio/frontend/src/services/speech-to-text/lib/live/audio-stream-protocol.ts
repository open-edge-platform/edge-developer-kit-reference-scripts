// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { logger } from '@/lib/logger'
import type { LiveProtocol, ProtocolContext } from './protocol'

/** Per-stage timings the OVMS worker reports for a transcribed utterance, in ms. */
interface StreamLatency {
  endpoint_ms: number
  queue_ms: number
  stt_ms: number
  e2e_ms: number
}

interface AudioStreamMessage {
  type:
    | 'ready'
    | 'speech_start'
    | 'speech_end'
    | 'transcript'
    | 'error'
    | 'done'
    | string
  /** `speech_end`: the cut utterance went on to be transcribed. */
  queued?: boolean
  text?: string
  start?: number
  end?: number
  latency?: StreamLatency
  message?: string
}

/**
 * OVMS worker's `/v1/audio/stream`: binary int16 PCM frames in, one `transcript` per utterance
 * out (`start`/`end` in seconds of received audio). Every queued utterance gets exactly one
 * `transcript` or `error`, so the outstanding ones are counted.
 */
export function audioStreamProtocol(ctx: ProtocolContext): LiveProtocol {
  const params = new URLSearchParams({ language: ctx.language })
  if (ctx.latencyLog) params.set('latency_log', 'true')
  if (ctx.vad) {
    params.set('pause_duration', String(ctx.vad.pauseSeconds))
    params.set('vad_threshold', String(ctx.vad.threshold))
  }
  let speaking = false
  let queued = 0
  const reportVoice = () => ctx.voice({ speaking, transcribing: queued > 0 })
  // Clamped at zero: the utterance a stop flushes is answered without a `speech_end` first.
  const settleOne = () => {
    queued = Math.max(0, queued - 1)
    reportVoice()
  }

  return {
    path: '/v1/audio/stream',
    params,
    binary: true,
    encodeFrame: (pcm) => pcm,
    openMessages: [],
    stopMessage: JSON.stringify({ event: 'stop' }),
    handleMessage: (raw, ws) => {
      let data: AudioStreamMessage
      try {
        data = JSON.parse(raw) as AudioStreamMessage
      } catch {
        return
      }
      switch (data.type) {
        case 'transcript': {
          const text = (data.text ?? '').trim()
          const start = Number(data.start ?? 0)
          const end = Number(data.end ?? start)
          ctx.measured({
            audioSeconds: end - start,
            inferenceMs: data.latency?.stt_ms,
          })
          // An empty one answers its utterance too.
          settleOne()
          if (!text) break
          if (ctx.latencyLog) {
            const latency = data.latency
            logger.info(
              `[latency] live transcript: ` +
                `perceived=${Math.round((ctx.elapsed() - end) * 1000)}ms ` +
                `endpoint=${latency?.endpoint_ms ?? '?'}ms ` +
                `queue=${latency?.queue_ms ?? '?'}ms ` +
                `stt=${latency?.stt_ms ?? '?'}ms ` +
                `worker_e2e=${latency?.e2e_ms ?? '?'}ms ` +
                `audio=${(end - start).toFixed(2)}s chars=${text.length}`,
            )
          }
          ctx.emit({
            text,
            start: start + ctx.timeOffset(),
            end: end + ctx.timeOffset(),
          })
          break
        }
        case 'speech_start':
          logger.debug(
            `[latency] speech detected at +${Math.round(ctx.elapsed() * 1000)}ms`,
          )
          speaking = true
          reportVoice()
          break
        case 'speech_end':
          speaking = false
          if (data.queued) queued += 1
          reportVoice()
          break
        case 'done':
          // The worker drained the final utterance; closing resolves `stop`.
          ws.close()
          break
        case 'error': {
          const message = data.message ?? 'Live transcription error'
          logger.warn('Live stream error:', message)
          ctx.onError?.(message)
          // A failed utterance gets no transcript.
          settleOne()
          break
        }
        default:
          break
      }
    },
  }
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { logger } from '@/lib/logger'
import type {
  LiveProtocol,
  ProtocolContext,
  SttStreamSettings,
} from './protocol'

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
    | 'words'
    | 'error'
    | 'done'
    | string
  /** `speech_end`: the cut utterance went on to be transcribed. */
  queued?: boolean
  text?: string
  start?: number
  end?: number
  latency?: StreamLatency
  /** `words`: the utterance's word timings, seconds of received audio. */
  words?: { word?: string; start?: number; end?: number }[]
  message?: string
}

/**
 * OVMS worker's `/v1/audio/stream`: binary int16 PCM frames in, one `transcript` per utterance
 * out (`start`/`end` in seconds of received audio). Every queued utterance gets exactly one
 * `transcript` or `error`, so the outstanding ones are counted.
 */
export function audioStreamProtocol(
  settings: SttStreamSettings,
  ctx: ProtocolContext,
): LiveProtocol {
  const { language, vad, wordTimestamps, onTranscript, onWords } = settings
  const params = new URLSearchParams({ language })
  if (ctx.latencyLog) params.set('latency_log', 'true')
  if (wordTimestamps) params.set('word_timestamps', 'true')
  if (vad) {
    params.set('pause_duration', String(vad.pauseSeconds))
    params.set('vad_threshold', String(vad.threshold))
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
          onTranscript?.({
            text,
            start: start + ctx.timeOffset(),
            end: end + ctx.timeOffset(),
          })
          break
        }
        case 'words': {
          // Follows its utterance's transcript; not one of the counted answers.
          const offset = ctx.timeOffset()
          const words = (data.words ?? []).flatMap((w) =>
            w.word && w.start != null && w.end != null
              ? [
                  {
                    text: w.word,
                    start: Number(w.start) + offset,
                    end: Number(w.end) + offset,
                  },
                ]
              : [],
          )
          if (words.length === 0) break
          onWords?.({
            start: Number(data.start ?? 0) + offset,
            end: Number(data.end ?? 0) + offset,
            words,
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

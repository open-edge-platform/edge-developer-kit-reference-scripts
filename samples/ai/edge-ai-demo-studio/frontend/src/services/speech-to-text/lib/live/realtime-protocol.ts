// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { logger } from '@/lib/logger'
import type { LiveProtocol, ProtocolContext } from './protocol'

interface RealtimeEvent {
  type: string
  item_id?: string
  transcript?: string
  reason?: string
  error?: { type?: string; message?: string }
  session?: { turn_detection?: { prefix_padding_ms?: number } | null }
}

// The OEP worker's server VAD keeps this much audio from before speech onset.
const DEFAULT_PREFIX_PADDING_MS = 300

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * OEP audio-analyzer `/v1/realtime`: base64 PCM in `input_audio_buffer.append` events.
 * Transcripts carry no audio offsets, so utterance bounds come from the speech_started/stopped
 * events in capture time, matched to `completed` by item id.
 *
 * The worker sends no `completed` for an empty utterance, but handles messages one at a time and
 * transcribes inline, so an empty `session.update` sent on `committed` is answered
 * (`transcription_session.updated`) only once that utterance is done: that clears `transcribing`.
 */
export function realtimeProtocol(ctx: ProtocolContext): LiveProtocol {
  let prefixPaddingSec = DEFAULT_PREFIX_PADDING_MS / 1000
  let pendingStart: number | null = null
  let lastSpeechStop: number | null = null
  let lastEnd = 0
  let speaking = false
  let transcribing = false
  const reportVoice = () => ctx.voice({ speaking, transcribing })
  // Audio bounds of each committed utterance, and when it was committed.
  const windows = new Map<
    string,
    { start: number; end: number; committedAt: number }
  >()
  // Transcript text seen so far; `completed` events are cumulative.
  let cumulative = ''

  return {
    path: '/v1/realtime',
    params: new URLSearchParams({
      intent: 'transcription',
      language: ctx.language,
    }),
    binary: false,
    encodeFrame: (pcm) =>
      JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: toBase64(pcm),
      }),
    openMessages: ctx.vad
      ? [
          JSON.stringify({
            type: 'session.update',
            session: {
              turn_detection: {
                threshold: ctx.vad.threshold,
                silence_duration_ms: Math.round(ctx.vad.pauseSeconds * 1000),
              },
            },
          }),
        ]
      : [],
    stopMessage: JSON.stringify({ type: 'session.close' }),
    handleMessage: (raw, ws) => {
      let data: RealtimeEvent
      try {
        data = JSON.parse(raw) as RealtimeEvent
      } catch {
        return
      }
      switch (data.type) {
        case 'transcription_session.created':
        case 'transcription_session.updated': {
          const padding = data.session?.turn_detection?.prefix_padding_ms
          if (typeof padding === 'number') prefixPaddingSec = padding / 1000
          if (data.type === 'transcription_session.updated' && transcribing) {
            transcribing = false
            reportVoice()
          }
          break
        }
        case 'input_audio_buffer.speech_started':
          pendingStart = Math.max(lastEnd, ctx.elapsed() - prefixPaddingSec)
          lastSpeechStop = null
          logger.debug(
            `[latency] speech detected at +${Math.round(ctx.elapsed() * 1000)}ms`,
          )
          speaking = true
          reportVoice()
          break
        case 'input_audio_buffer.speech_stopped':
          lastSpeechStop = ctx.elapsed()
          speaking = false
          reportVoice()
          break
        case 'input_audio_buffer.committed': {
          const start = pendingStart ?? lastEnd
          const end = Math.max(start, lastSpeechStop ?? ctx.elapsed())
          if (data.item_id) {
            windows.set(data.item_id, {
              start,
              end,
              committedAt: ctx.elapsed(),
            })
          }
          lastEnd = end
          pendingStart = null
          lastSpeechStop = null
          transcribing = true
          reportVoice()
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'session.update', session: {} }))
          }
          break
        }
        case 'conversation.item.input_audio_transcription.completed': {
          const full = (data.transcript ?? '').trim()
          // `transcript` is cumulative for the session: keep the new suffix, or the whole text
          // if it no longer extends the previous one (session reset upstream).
          const text = (
            full.startsWith(cumulative) ? full.slice(cumulative.length) : full
          ).trim()
          cumulative = full
          const bounds = data.item_id ? windows.get(data.item_id) : undefined
          if (data.item_id) windows.delete(data.item_id)
          if (bounds) {
            // The worker reports no model time, so measure commit to transcript.
            ctx.measured({
              audioSeconds: bounds.end - bounds.start,
              responseMs: Math.round(
                (ctx.elapsed() - bounds.committedAt) * 1000,
              ),
            })
          }
          if (!text) break
          const start = bounds?.start ?? lastEnd
          const end = bounds?.end ?? ctx.elapsed()
          if (ctx.latencyLog) {
            // Perceived latency: end of the spoken audio to the transcript reaching the UI.
            logger.info(
              `[latency] live transcript: ` +
                `perceived=${Math.round((ctx.elapsed() - end) * 1000)}ms ` +
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
        case 'error': {
          const message = data.error?.message ?? 'Live transcription error'
          logger.warn('Live stream error:', message)
          ctx.onError?.(message)
          break
        }
        default:
          break
      }
    },
  }
}

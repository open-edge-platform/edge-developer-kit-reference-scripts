// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { logger } from '@/lib/logger'
import type { LiveProtocolFactory } from '@/services/speech-to-text/lib/live/protocol'
import type { DiarizeRequest, DiarizeSegment } from '../hooks'

/** How the live stream names speakers: the `POST /v1/diarize` fields. */
export type LiveDiarizationConfig = Omit<DiarizeRequest, 'file'>

/** A live pass's answer, on the reference timeline (see `LiveStartOptions.timeOrigin`). */
export interface LiveSpeakers {
  /** Every speaker turn of the recording so far. */
  segments: DiarizeSegment[]
  /**
   * Where the stream's audio began: later than the recording's own start when it joined late, so
   * an utterance starting earlier was never heard.
   */
  coveredFrom: number
  /** How far the pass heard: an utterance ending later has no speaker yet. */
  coveredUntil: number
}

interface SpeakersMessage {
  type: string
  segments?: DiarizeSegment[]
  covered_until?: number
  start?: number
  end?: number
  latency?: { stt_ms?: number }
  message?: string
}

/**
 * The diarization worker's `/v1/audio/stream`: the speech-to-text worker's VAD stream (same PCM
 * frames, same utterance cuts), answering each utterance with the speakers of the whole recording
 * so far. For `LiveStartOptions.protocol`.
 */
export function diarizationStreamProtocol(
  config: LiveDiarizationConfig,
  onSpeakers: (speakers: LiveSpeakers) => void,
): LiveProtocolFactory {
  return (ctx) => ({
    path: '/v1/audio/stream',
    params: new URLSearchParams(
      ctx.latencyLog ? { latency_log: 'true' } : undefined,
    ),
    binary: true,
    encodeFrame: (pcm) => pcm,
    // In the first frame rather than the URL: voice prints don't belong in access logs.
    openMessages: [
      JSON.stringify({
        event: 'config',
        speaker_profiles: config.speakerProfiles,
        reference_embedding: config.referenceEmbedding,
        reference_label: config.referenceLabel,
        other_label: config.otherLabel,
        unknown_label: config.unknownLabel,
        num_speakers: config.numSpeakers,
        min_speakers: config.minSpeakers,
        max_speakers: config.maxSpeakers,
        speaker_match_threshold: config.speakerMatchThreshold,
      }),
    ],
    stopMessage: JSON.stringify({ event: 'stop' }),
    handleMessage: (raw, ws) => {
      let data: SpeakersMessage
      try {
        data = JSON.parse(raw) as SpeakersMessage
      } catch {
        return
      }
      switch (data.type) {
        case 'speakers': {
          const offset = ctx.timeOffset()
          ctx.measured({
            audioSeconds: Number(data.end ?? 0) - Number(data.start ?? 0),
            inferenceMs: data.latency?.stt_ms,
          })
          onSpeakers({
            segments: (data.segments ?? []).map((s) => ({
              speaker: s.speaker,
              start: s.start + offset,
              end: s.end + offset,
            })),
            // The worker's time 0, on the reference timeline.
            coveredFrom: offset,
            // Nothing heard yet stays nothing, not the offset.
            coveredUntil: data.covered_until ? data.covered_until + offset : 0,
          })
          break
        }
        case 'done':
          ws.close()
          break
        case 'error': {
          const message = data.message ?? 'Live diarization error'
          logger.warn('Live diarization error:', message)
          ctx.onError?.(message)
          break
        }
        default:
          break
      }
    },
  })
}

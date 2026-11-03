// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { SnapshotStore } from '@/services/common/demo/snapshot-store'
import { serverTimingMs, startWork } from '@/services/common/metrics/work'
import { encodedAudioSeconds } from './audio-duration'
import { requestSpeech } from './speech-request'
import { StreamingAudioPlayer } from './streaming-audio-player'
import type { SpeechRequestParams } from './tts-models'
import { WavStreamReader } from './wav-stream'

/** `idle` before the first audio and once it has played out or stopped. */
export type StreamPlayback = 'idle' | 'playing' | 'paused'

export interface SpeechRequest {
  id: number
  model: string
  params: SpeechRequestParams
}

export interface SpeechResult extends SpeechRequest {
  blob: Blob
}

/** Why the latest synthesis produced no file. */
export type SpeechFailure =
  { kind: 'error'; error: Error } | { kind: 'interrupted' }

export interface SpeechSnapshot {
  pending: SpeechRequest | null
  /** Belongs to the latest synthesis and can outlast it. */
  playback: StreamPlayback
  /** The last synthesis that produced a file, whatever came after it. */
  result: SpeechResult | null
  failure: SpeechFailure | null
}

const IDLE: SpeechSnapshot = {
  pending: null,
  playback: 'idle',
  result: null,
  failure: null,
}

/**
 * A demo's syntheses and live playback, outside any component so results survive remounts.
 * Holds an `AudioContext` while playing live, so its owner stops it when it goes out of sight.
 */
export class SpeechSynthesis extends SnapshotStore<SpeechSnapshot> {
  private player: StreamingAudioPlayer | null = null
  private controller: AbortController | null = null
  private nextId = 1
  private readonly onPendingChange?: (pending: boolean) => void

  constructor(onPendingChange?: (pending: boolean) => void) {
    super(IDLE)
    this.onPendingChange = onPendingChange
  }

  protected onSnapshotChange(previous: SpeechSnapshot, next: SpeechSnapshot) {
    const wasPending = previous.pending !== null
    const isPending = next.pending !== null
    if (wasPending !== isPending) this.onPendingChange?.(isPending)
  }

  private update(patch: Partial<SpeechSnapshot>) {
    this.patchSnapshot(patch)
  }

  /** Cancels the request and silences its playback, without reporting it. */
  private halt() {
    const controller = this.controller
    this.controller = null
    controller?.abort()
    this.player?.close()
    this.player = null
  }

  /** Cancels synthesis and playback; a cancelled synthesis is reported as interrupted. */
  stop = () => {
    const { pending, playback } = this.snapshot
    this.halt()
    if (!pending && playback === 'idle') return
    this.update({
      pending: null,
      playback: 'idle',
      ...(pending ? { failure: { kind: 'interrupted' as const } } : {}),
    })
  }

  /** The complete file, or `null` when the request failed or was stopped. */
  synthesize = async (
    apiBase: string | undefined,
    model: string,
    params: SpeechRequestParams,
  ): Promise<Blob | null> => {
    this.halt()
    const request: SpeechRequest = { id: this.nextId++, model, params }
    const controller = new AbortController()
    this.controller = controller
    const live = params.responseFormat === 'wav'
    // Created inside the click: browsers only let an AudioContext start after a user gesture.
    const player = live
      ? new StreamingAudioPlayer({
          onEnded: () => {
            if (this.player !== player) return
            this.player = null
            this.update({ playback: 'idle' })
          },
        })
      : null
    this.player = player
    this.update({ pending: request, playback: 'idle', failure: null })

    const settle = (patch: Partial<SpeechSnapshot>) => {
      if (this.controller !== controller) return
      this.controller = null
      this.update({ pending: null, ...patch })
    }

    // Timed to the last byte: streamed headers leave before the work is done, so only a whole
    // file carries the worker's own time.
    const timer = startWork(apiBase)
    try {
      const res = await requestSpeech(
        apiBase,
        model,
        { ...params, stream: live },
        controller.signal,
      )
      let blob: Blob
      let audioSeconds: number | undefined
      if (!player || !res.body) {
        player?.finish()
        blob = await res.blob()
        audioSeconds = encodedAudioSeconds(
          new Uint8Array(await blob.arrayBuffer()),
          params.responseFormat,
        )
      } else {
        const wav = new WavStreamReader()
        const reader = res.body.getReader()
        let started = false
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const frames = wav.push(value)
          if (!frames || !wav.format) continue
          player.enqueue(frames, wav.format.sampleRate)
          if (!started && this.player === player) {
            started = true
            this.update({ playback: 'playing' })
          }
        }
        player.finish()
        blob = wav.toBlob()
        audioSeconds = wav.seconds
      }
      if (controller.signal.aborted) {
        timer.aborted()
        return null
      }
      timer.finish({
        inferenceMs: serverTimingMs(res.headers),
        quantities: audioSeconds === undefined ? {} : { audioSeconds },
      })
      settle({ result: { ...request, blob } })
      return blob
    } catch (err) {
      timer.settleError(controller.signal)
      // Stopped or replaced by a newer synthesis, which reports itself.
      if (controller.signal.aborted) return null
      player?.close()
      this.player = null
      settle({
        playback: 'idle',
        failure: {
          kind: 'error',
          error: err instanceof Error ? err : new Error(String(err)),
        },
      })
      return null
    }
  }

  pause = () => {
    const player = this.player
    if (!player) return
    player.pause()
    this.update({ playback: 'paused' })
  }

  resume = () => {
    const player = this.player
    if (!player) return
    player.resume()
    this.update({ playback: 'playing' })
  }

  /** Seconds played and received so far. */
  position = () => ({
    currentTime: this.player?.currentTime ?? 0,
    duration: this.player?.duration ?? 0,
  })

  /** Releases everything, the last file included. */
  dispose() {
    this.halt()
    this.setSnapshot(IDLE)
  }
}

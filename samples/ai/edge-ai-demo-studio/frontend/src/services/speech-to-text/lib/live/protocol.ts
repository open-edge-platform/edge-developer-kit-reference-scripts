// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// Types shared by the live protocols: the two transcription protocols' (OEP realtime; OVMS and
// MERaLiON audio stream) and diarization's.

import type { TimedText } from '../transcript-export'

export interface LiveTranscript {
  text: string
  /** Seconds from capture start (on the reference timeline, see `timeOrigin`). */
  start: number
  /** Seconds, like `start`. */
  end: number
}

/** Word timings of an utterance already emitted as a `LiveTranscript`, on the same timeline. */
export interface LiveWords {
  /** The utterance's `start` and `end`, as its transcript had them. */
  start: number
  end: number
  words: TimedText[]
}

/** The worker-side VAD's state, so it lags the audio by the worker's analysis window. */
export interface VoiceActivity {
  /** An utterance is open. */
  speaking: boolean
  /** An utterance it cut is still being transcribed. */
  transcribing: boolean
}

export const NO_VOICE_ACTIVITY: VoiceActivity = {
  speaking: false,
  transcribing: false,
}

export interface LiveVadSettings {
  /** Silence, in seconds, that ends an utterance. */
  pauseSeconds: number
  /** The backend's detection threshold (`getSttVadThreshold`). */
  threshold: number
}

/** What a transcription protocol asks the worker for, and where its answers go. */
export interface SttStreamSettings {
  language: string
  /** Unset: the worker's own defaults. */
  vad?: LiveVadSettings
  /** Ask for each utterance's word timings (OVMS on Qwen3-ASR); ignored where unsupported. */
  wordTimestamps?: boolean
  onTranscript?: (transcript: LiveTranscript) => void
  /** Each utterance's word timings, after its transcript. */
  onWords?: (words: LiveWords) => void
}

/** One worker's side of the live socket. */
export interface LiveProtocol {
  path: string
  params: URLSearchParams
  binary: boolean
  encodeFrame: (pcm: ArrayBuffer) => string | ArrayBuffer
  /** Sent once the socket opens, before any audio. */
  openMessages: string[]
  stopMessage: string
  handleMessage: (data: string, ws: WebSocket) => void
}

/** What the session gives a protocol, whichever worker it speaks to. */
export interface ProtocolContext {
  latencyLog: boolean
  /** Seconds since capture started. */
  elapsed: () => number
  /** Offset from capture time to the reference recording timeline, seconds. */
  timeOffset: () => number
  voice: (activity: VoiceActivity) => void
  /** Records an utterance for the demo's Live metrics. */
  measured: (work: {
    audioSeconds: number
    inferenceMs?: number
    responseMs?: number
  }) => void
  onError?: (message: string) => void
}

/** A protocol, built once the session's context exists (`LiveStartOptions.protocol`). */
export type LiveProtocolFactory = (ctx: ProtocolContext) => LiveProtocol

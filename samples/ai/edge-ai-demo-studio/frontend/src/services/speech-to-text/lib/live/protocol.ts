// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// Types shared by the two live transcription backends' protocols.

export interface LiveTranscript {
  text: string
  /** Seconds from capture start (on the reference timeline, see `timeOrigin`). */
  start: number
  /** Seconds, like `start`. */
  end: number
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

/** One backend's side of the live socket. */
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

export interface ProtocolContext {
  language: string
  /** Unset: the worker's own defaults. */
  vad?: LiveVadSettings
  latencyLog: boolean
  /** Seconds since capture started. */
  elapsed: () => number
  /** Offset from capture time to the reference recording timeline, seconds. */
  timeOffset: () => number
  emit: (transcript: LiveTranscript) => void
  voice: (activity: VoiceActivity) => void
  /** Records an utterance for the demo's Live metrics. */
  measured: (work: {
    audioSeconds: number
    inferenceMs?: number
    responseMs?: number
  }) => void
  onError?: (message: string) => void
}

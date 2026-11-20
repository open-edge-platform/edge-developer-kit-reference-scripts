// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { TimedText } from '@/services/speech-to-text/lib/transcript-export'

export type SessionStatus =
  'idle' | 'recording' | 'processing' | 'completed' | 'error'

export interface TranscriptEntry {
  speaker: string
  text: string
  start: number
  end: number
}

/** One VAD-cut utterance of a live recording, with its word timings once they arrive. */
export interface LiveUtterance {
  text: string
  start: number
  end: number
  words?: TimedText[]
}

/**
 * A consultation as the Medical Scribe Database stores it. The timestamps
 * are ISO 8601 (older sessions hold display text; see `formatTimestamp`).
 */
export interface Session {
  id: string
  name: string
  doctorProfileId: string | null
  /** As the server last saw it; a renamed profile shows its new name. */
  doctorProfileName: string | null
  language: string
  sessionCreatedAt: string
  status: SessionStatus
  transcripts: TranscriptEntry[]
  dialogueCreatedAt: string | null
  soapReport: string | null
  reportCreatedAt: string | null
  errorMessage?: string
}

/** What a session update may change. */
export type SessionUpdate = Partial<Omit<Session, 'id'>>

export interface DoctorProfile {
  id: string
  name: string
  embedding: number[] | null
}

export type DiarizationSeg = {
  speaker: string
  start: number
  end: number
}

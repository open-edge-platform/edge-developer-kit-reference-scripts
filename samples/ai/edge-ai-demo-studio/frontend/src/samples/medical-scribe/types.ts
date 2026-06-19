// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export type SessionStatus =
  | 'idle'
  | 'recording'
  | 'processing'
  | 'completed'
  | 'error'

export interface TranscriptEntry {
  speaker: string
  text: string
  start: number
  end: number
}

export interface Session {
  id: string
  name: string
  doctorProfileId: string | null
  doctorProfileName: string | null
  language: string
  sessionCreatedAt: string
  status: SessionStatus
  transcripts: TranscriptEntry[]
  dialogueCreatedAt: string | null
  soapReport: string | null
  reportCreatedAt: string | null
  audioBlob: Blob | null
  errorMessage?: string
}

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

export type WhisperSeg = {
  start: number
  end: number
  text: string
}

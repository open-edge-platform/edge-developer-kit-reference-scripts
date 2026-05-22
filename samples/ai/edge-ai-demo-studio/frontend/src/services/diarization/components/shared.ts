// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export const SPEAKER_COLORS = [
  'bg-blue-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-violet-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-pink-500',
] as const

export interface EnrolledSpeaker {
  id: string
  label: string
  file: File | null
  embedding: number[] | null
  status: 'idle' | 'enrolling' | 'enrolled' | 'error'
  error?: string
}

export function createSpeaker(index: number): EnrolledSpeaker {
  return {
    id: crypto.randomUUID(),
    label: `Speaker ${index}`,
    file: null,
    embedding: null,
    status: 'idle',
  }
}

export function getSpeakerColorIndex(
  speaker: string,
  speakerMap: Map<string, number>,
): number {
  return (speakerMap.get(speaker) ?? 0) % SPEAKER_COLORS.length
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1).padStart(4, '0')
  return `${m}:${s}`
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Diarization demo speakers: enrolled voice profiles, their colours and segment time format. */

/** One categorical colour per speaker, cycled when there are more. */
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

/** The lowest unused default label number; after a removal, counting would repeat a used name. */
export function nextSpeakerIndex(
  speakers: Pick<EnrolledSpeaker, 'label'>[],
): number {
  const labels = new Set(speakers.map((s) => s.label.trim()))
  let index = 1
  while (labels.has(`Speaker ${index}`)) index += 1
  return index
}

/**
 * Colour index of every speaker shown: an enrolled speaker keeps its card's index, others take the
 * next ones after the profiles, so colours repeat only past the palette's end.
 */
export function speakerColorMap(
  profiles: Pick<EnrolledSpeaker, 'label' | 'status'>[],
  resultSpeakers: Iterable<string>,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const [i, s] of profiles.entries()) {
    if (s.status === 'enrolled' && !map.has(s.label)) map.set(s.label, i)
  }
  let next = profiles.length
  for (const speaker of resultSpeakers) {
    if (!map.has(speaker)) map.set(speaker, next++)
  }
  return map
}

export function getSpeakerColorIndex(
  speaker: string,
  speakerMap: Map<string, number>,
): number {
  return (speakerMap.get(speaker) ?? 0) % SPEAKER_COLORS.length
}

/**
 * A segment boundary as `m:ss.t` (`0:01.5`, `1:05.0`) — tenths matter for
 * speech turns, so this is not `formatClock`'s whole-second `m:ss`.
 */
export function formatSegmentTime(seconds: number): string {
  // Rounded before the minutes are split off, so 59.96 s reads 1:00.0.
  const tenths = Math.round(seconds * 10)
  const m = Math.floor(tenths / 600)
  const s = ((tenths % 600) / 10).toFixed(1).padStart(4, '0')
  return `${m}:${s}`
}

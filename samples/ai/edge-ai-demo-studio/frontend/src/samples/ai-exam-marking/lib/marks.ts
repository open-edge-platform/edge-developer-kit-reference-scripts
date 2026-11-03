// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { LLMResultEntry, Marks, MarksTotal, ProcessingStep } from './types'

/** Percentage a student needs to pass. */
export const PASS_MARK_PCT = 50

export const isPass = (pct: number) => pct >= PASS_MARK_PCT

/** `3/5`; `-/5` while not graded; `3/N/A` without a maximum. */
export function formatMarks({ awarded, max }: Marks): string {
  return `${awarded ?? '-'}/${max ?? 'N/A'}`
}

export function formatTotal({ awarded, max }: MarksTotal): string {
  return `${awarded}/${max}`
}

/** Marks that count towards a score; `null` when not graded or without a maximum above zero. */
export function scoreOf(marks: Marks): MarksTotal | null {
  const { awarded, max } = marks
  if (awarded === null || max === null || max === 0) return null
  return { awarded, max }
}

/**
 * The results with running totals rebuilt from each question's marks (as the pipeline builds them),
 * so a mark changed in review moves every later total. An ungraded question adds nothing.
 */
export function withRunningTotals(results: LLMResultEntry[]): LLMResultEntry[] {
  let awarded = 0
  let max = 0
  return results.map((entry) => {
    const score = scoreOf(entry.marks)
    if (score) {
      awarded += score.awarded
      max += score.max
    }
    return { ...entry, runningTotal: { awarded, max } }
  })
}

/** The annotated sheet's total: an ungraded question adds its maximum but no marks. */
export function sheetTotal(results: LLMResultEntry[]): MarksTotal {
  return results.reduce(
    (total, { marks }) => ({
      awarded: total.awarded + (marks.awarded ?? 0),
      max: total.max + (marks.max ?? 0),
    }),
    { awarded: 0, max: 0 },
  )
}

/** The answer-sheet card's status line for a pipeline step. */
export function describeStep(step: ProcessingStep): string {
  switch (step.phase) {
    case 'queued':
      return 'Queued…'
    case 'extracting':
      return 'Extracting text…'
    case 'grading':
      return `Grading question ${step.question} of ${step.total}…`
    case 'annotating':
      return 'Annotating image…'
  }
}

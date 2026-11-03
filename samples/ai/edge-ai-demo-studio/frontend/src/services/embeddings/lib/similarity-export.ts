// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type {
  ComparisonSubject,
  SimilarityResult,
} from '../hooks/use-embedding-comparison'

export function rankBySimilarity(
  results: SimilarityResult[],
): SimilarityResult[] {
  return [...results].sort((a, b) => b.score - a.score)
}

export function describeSubject(subject: ComparisonSubject): string {
  return subject.kind === 'text' ? subject.text : `Image ${subject.name}`
}

/** One CSV field, quoted when it holds a separator, quote or line break. */
function csvField(value: string | number): string {
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function similarityText(
  ranked: SimilarityResult[],
  subject: ComparisonSubject | null,
): string {
  const lines = ranked.map(
    (item, i) => `${i + 1}. ${item.score.toFixed(4)}  ${item.text}`,
  )
  return subject
    ? [`Compared with: ${describeSubject(subject)}`, ...lines].join('\n')
    : lines.join('\n')
}

export function similarityCsv(
  ranked: SimilarityResult[],
  subject: ComparisonSubject | null,
): string {
  const header = ['rank', 'similarity', 'entered_as', 'reference', 'subject']
  const subjectText = subject ? describeSubject(subject) : ''
  const rows = ranked.map((item, i) =>
    [i + 1, item.score.toFixed(6), item.index + 1, item.text, subjectText]
      .map(csvField)
      .join(','),
  )
  return [header.join(','), ...rows].join('\n') + '\n'
}

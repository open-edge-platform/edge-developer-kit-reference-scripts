// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { isPass, scoreOf } from './marks'
import type { MarksTotal, SavedRecord } from './types'

const SCORE_BUCKETS = [
  { label: '0-20%', min: 0, max: 20 },
  { label: '21-40%', min: 21, max: 40 },
  { label: '41-60%', min: 41, max: 60 },
  { label: '61-80%', min: 61, max: 80 },
  { label: '81-100%', min: 81, max: 100 },
]

export type DashboardStats = {
  totalStudents: number
  averagePct: number | null
  passRate: number | null
  humanReviewCount: number
  scoredRecords: { record: SavedRecord; pct: number }[]
  buckets: { label: string; min: number; max: number; count: number }[]
  maxBucketCount: number
  questionStats: {
    label: string
    avgPct: number
    avgAwarded: number
    avgMax: number
  }[]
}

/** A record's final score (its last running total), or null without one. */
export function getRecordTotalScore(record: SavedRecord): MarksTotal | null {
  const last = record.llmResult.response.at(-1)
  if (!last || last.runningTotal.max === 0) return null
  return last.runningTotal
}

/** Aggregate class-wide statistics from all saved grading records. */
export function computeDashboardStats(
  records: SavedRecord[],
): DashboardStats | null {
  if (records.length === 0) return null

  const scoredRecords: { record: SavedRecord; pct: number }[] = []

  for (const record of records) {
    const total = getRecordTotalScore(record)
    if (total) {
      scoredRecords.push({
        record,
        pct: Math.round((total.awarded / total.max) * 100),
      })
    }
  }

  const totalStudents = records.length
  const averagePct =
    scoredRecords.length > 0
      ? Math.round(
          scoredRecords.reduce((sum, r) => sum + r.pct, 0) /
            scoredRecords.length,
        )
      : null
  const passCount = scoredRecords.filter((r) => isPass(r.pct)).length
  const passRate =
    scoredRecords.length > 0
      ? Math.round((passCount / scoredRecords.length) * 100)
      : null
  const humanReviewCount = records.reduce(
    (sum, r) => sum + r.llmResult.response.filter((e) => e.humanReview).length,
    0,
  )

  // Score distribution buckets
  const buckets = SCORE_BUCKETS.map((bucket) => ({
    ...bucket,
    count: scoredRecords.filter(
      (r) => r.pct >= bucket.min && r.pct <= bucket.max,
    ).length,
  }))
  const maxBucketCount = Math.max(...buckets.map((b) => b.count), 1)

  // Per-question average
  const questionMap: Record<
    string,
    { totalAwarded: number; totalMax: number; count: number }
  > = {}
  for (const record of records) {
    for (const entry of record.llmResult.response) {
      const score = scoreOf(entry.marks)
      if (!score) continue
      const { awarded, max } = score
      const key = `Q${entry.questionNumber}`
      if (!questionMap[key]) {
        questionMap[key] = { totalAwarded: 0, totalMax: 0, count: 0 }
      }
      questionMap[key].totalAwarded += awarded
      questionMap[key].totalMax += max
      questionMap[key].count += 1
    }
  }
  const questionStats = Object.entries(questionMap)
    .map(([label, data]) => ({
      label,
      avgPct:
        data.totalMax > 0
          ? Math.round((data.totalAwarded / data.totalMax) * 100)
          : 0,
      avgAwarded:
        data.count > 0 ? +(data.totalAwarded / data.count).toFixed(1) : 0,
      avgMax: data.count > 0 ? +(data.totalMax / data.count).toFixed(1) : 0,
    }))
    .sort((a, b) => {
      const numA = parseInt(a.label.replace('Q', ''))
      const numB = parseInt(b.label.replace('Q', ''))
      return numA - numB
    })

  return {
    totalStudents,
    averagePct,
    passRate,
    humanReviewCount,
    scoredRecords,
    buckets,
    maxBucketCount,
    questionStats,
  }
}

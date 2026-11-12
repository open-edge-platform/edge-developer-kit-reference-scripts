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
  /** Students without a score yet, after merging their papers. */
  unscoredRecords: SavedRecord[]
  buckets: { label: string; min: number; max: number; count: number }[]
  maxBucketCount: number
  questionStats: {
    label: string
    avgPct: number
    avgAwarded: number
    avgMax: number
  }[]
}

/** The marking scheme's total marks: the denominator of a record's score. */
function configuredTotalMarks(record: SavedRecord): number {
  return record.dataEntries.reduce(
    (sum, entry) => (Number.isFinite(entry.marks) ? sum + entry.marks : sum),
    0,
  )
}

/**
 * A record's score, or null without one: marks awarded on the questions graded so far, over the
 * full marking scheme's total.
 */
function getRecordTotalScore(record: SavedRecord): MarksTotal | null {
  const results = record.llmResult.response
  if (results.length === 0) return null
  const max = configuredTotalMarks(record)
  if (max <= 0) return null
  const awarded = results.reduce(
    (sum, { marks }) => sum + (scoreOf(marks)?.awarded ?? 0),
    0,
  )
  return { awarded, max }
}

const byTime = (record: SavedRecord) => new Date(record.timestamp).getTime()

/**
 * Each graded paper is its own history record, so a student re-graded twice for the same subject
 * (e.g. multiple pages/attempts) has multiple entries. The dashboard still reports one row per
 * student+subject, so merge those papers here: data entries/question results are combined by
 * question number (last paper wins per question) before totals are computed.
 */
function mergeRecordsForDashboard(records: SavedRecord[]): SavedRecord[] {
  const groups = new Map<string, SavedRecord[]>()
  for (const record of records) {
    const key = `${record.studentId ?? record.id}::${record.subjectId ?? ''}`
    const group = groups.get(key)
    if (group) group.push(record)
    else groups.set(key, [record])
  }

  return Array.from(groups.values()).map((group) => {
    if (group.length === 1) return group[0]!

    const oldestFirst = [...group].sort((a, b) => byTime(a) - byTime(b))
    const latest = oldestFirst.at(-1)!
    const dataEntryMap = new Map<string, SavedRecord['dataEntries'][number]>()
    const responseMap = new Map<
      string,
      SavedRecord['llmResult']['response'][number]
    >()
    for (const paper of oldestFirst) {
      for (const entry of paper.dataEntries) {
        dataEntryMap.set(String(entry.number), entry)
      }
      for (const entry of paper.llmResult.response) {
        responseMap.set(entry.questionNumber, entry)
      }
    }

    return {
      ...latest,
      dataEntries: Array.from(dataEntryMap.values()),
      llmResult: {
        ...latest.llmResult,
        response: Array.from(responseMap.values()),
      },
    }
  })
}

/** Aggregate class-wide statistics from all saved grading records. */
export function computeDashboardStats(
  savedRecords: SavedRecord[],
): DashboardStats | null {
  if (savedRecords.length === 0) return null
  const records = mergeRecordsForDashboard(savedRecords)

  const scoredRecords: { record: SavedRecord; pct: number }[] = []
  const unscoredRecords: SavedRecord[] = []

  for (const record of records) {
    const total = getRecordTotalScore(record)
    if (total) {
      scoredRecords.push({
        record,
        pct: Math.round((total.awarded / total.max) * 100),
      })
    } else {
      unscoredRecords.push(record)
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
    unscoredRecords,
    buckets,
    maxBucketCount,
    questionStats,
  }
}

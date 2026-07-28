// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useMemo } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Users, TrendingUp, AlertCircle, Award, BookOpen } from 'lucide-react'
import type { SavedRecord } from '@/lib/ai-exam-marking/types'

/** Parse "awarded/max" strings like "3/5" into [awarded, max] numbers. */
function parseScore(value: string): [number, number] | null {
  const parts = value.split('/')
  if (parts.length !== 2) return null
  const awarded = parseFloat(parts[0] ?? '')
  const max = parseFloat(parts[1] ?? '')
  if (isNaN(awarded) || isNaN(max) || max === 0) return null
  return [awarded, max]
}

/** Get the final accumulated score for a record as [awarded, max] or null. */
function getRecordTotalScore(record: SavedRecord): [number, number] | null {
  const entries = record.llmResult.response
  if (entries.length === 0) return null
  const last = entries[entries.length - 1]
  if (!last) return null
  return parseScore(last.marksAccumulatedOverMaxMarksAccumulated)
}

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

interface ResultsDashboardProps {
  records: SavedRecord[]
  onStats?: (stats: DashboardStats | null) => void
}

const SCORE_BUCKETS = [
  { label: '0-20%', min: 0, max: 20 },
  { label: '21-40%', min: 21, max: 40 },
  { label: '41-60%', min: 41, max: 60 },
  { label: '61-80%', min: 61, max: 80 },
  { label: '81-100%', min: 81, max: 100 },
]

export function ResultsDashboard({ records, onStats }: ResultsDashboardProps) {
  const stats = useMemo(() => {
    if (records.length === 0) return null

    const scoredRecords: { record: SavedRecord; pct: number }[] = []

    for (const record of records) {
      const total = getRecordTotalScore(record)
      if (total) {
        const [awarded, max] = total
        scoredRecords.push({ record, pct: Math.round((awarded / max) * 100) })
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
    const passCount = scoredRecords.filter((r) => r.pct >= 50).length
    const passRate =
      scoredRecords.length > 0
        ? Math.round((passCount / scoredRecords.length) * 100)
        : null
    const humanReviewCount = records.reduce(
      (sum, r) =>
        sum + r.llmResult.response.filter((e) => e.humanReview).length,
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
        const score = parseScore(entry.marksAwardedOverMaxMarks)
        if (!score) continue
        const [awarded, max] = score
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
  }, [records])

  useEffect(() => {
    onStats?.(stats)
  }, [stats, onStats])

  if (records.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Results Dashboard</CardTitle>
          <CardDescription className="text-xs">
            No grading records available yet
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <BookOpen className="text-muted-foreground h-10 w-10" />
            <p className="text-muted-foreground text-sm">
              Grade some answer sheets first, then come back to view statistics.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {!stats ? (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <BookOpen className="text-muted-foreground h-10 w-10" />
              <p className="text-muted-foreground text-sm">
                No records to display.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-muted-foreground text-xs font-medium">
                      Total Students
                    </p>
                    <p className="mt-1 text-3xl font-bold">
                      {stats.totalStudents}
                    </p>
                  </div>
                  <div className="bg-primary/10 rounded-full p-2">
                    <Users className="text-primary h-5 w-5" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-muted-foreground text-xs font-medium">
                      Class Average
                    </p>
                    <p className="mt-1 text-3xl font-bold">
                      {stats.averagePct !== null ? `${stats.averagePct}%` : '—'}
                    </p>
                  </div>
                  <div className="bg-primary/10 rounded-full p-2">
                    <TrendingUp className="text-primary h-5 w-5" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-muted-foreground text-xs font-medium">
                      Pass Rate (≥50%)
                    </p>
                    <p className="mt-1 text-3xl font-bold">
                      {stats.passRate !== null ? `${stats.passRate}%` : '—'}
                    </p>
                  </div>
                  <div className="rounded-full bg-green-500/10 p-2">
                    <Award className="h-5 w-5 text-green-600 dark:text-green-400" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-muted-foreground text-xs font-medium">
                      Human Review
                    </p>
                    <p className="mt-1 text-3xl font-bold">
                      {stats.humanReviewCount}
                    </p>
                  </div>
                  <div className="rounded-full bg-amber-500/10 p-2">
                    <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Score Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Score Distribution</CardTitle>
                <CardDescription className="text-xs">
                  Number of students in each score range
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {stats.buckets.map((bucket) => (
                    <div key={bucket.label} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground w-16 shrink-0">
                          {bucket.label}
                        </span>
                        <div className="mx-3 flex-1">
                          <div className="bg-muted rounded-full">
                            <div
                              className="bg-primary h-2 rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.round((bucket.count / stats.maxBucketCount) * 100)}%`,
                                minWidth: bucket.count > 0 ? '4px' : '0',
                              }}
                            />
                          </div>
                        </div>
                        <span className="text-foreground w-6 text-right font-medium">
                          {bucket.count}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Per-Question Performance */}
            {stats.questionStats.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    Per-Question Average
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Average marks awarded per question across all students
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {stats.questionStats.map((q) => (
                      <div key={q.label} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground w-8 shrink-0 font-medium">
                            {q.label}
                          </span>
                          <div className="mx-3 flex-1">
                            <div className="bg-muted rounded-full">
                              <div
                                className={`h-2 rounded-full transition-all duration-500 ${
                                  q.avgPct >= 75
                                    ? 'bg-green-500'
                                    : q.avgPct >= 50
                                      ? 'bg-primary'
                                      : q.avgPct >= 25
                                        ? 'bg-amber-500'
                                        : 'bg-red-500'
                                }`}
                                style={{
                                  width: `${q.avgPct}%`,
                                  minWidth: q.avgPct > 0 ? '4px' : '0',
                                }}
                              />
                            </div>
                          </div>
                          <span className="text-foreground w-16 text-right font-medium">
                            {q.avgAwarded}/{q.avgMax} ({q.avgPct}%)
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Student Results Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Student Results</CardTitle>
              <CardDescription className="text-xs">
                Individual scores for all graded students
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-muted-foreground pb-2 text-left font-medium">
                        Student
                      </th>
                      <th className="text-muted-foreground pb-2 text-left font-medium">
                        Date
                      </th>
                      <th className="text-muted-foreground pb-2 text-right font-medium">
                        Score
                      </th>
                      <th className="text-muted-foreground pb-2 text-right font-medium">
                        Result
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {stats.scoredRecords.map(({ record, pct }) => (
                      <tr
                        key={record.id}
                        className="hover:bg-muted/30 transition-colors"
                      >
                        <td className="py-2.5 pr-4">
                          <div>
                            <p className="font-medium">
                              {record.studentId ?? 'Unknown'}
                            </p>
                            {record.studentName && (
                              <p className="text-muted-foreground">
                                {record.studentName}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="text-muted-foreground py-2.5 pr-4">
                          {new Date(record.timestamp).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 pr-4 text-right font-medium">
                          {pct}%
                        </td>
                        <td className="py-2.5 text-right">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              pct >= 50
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            }`}
                          >
                            {pct >= 50 ? 'Pass' : 'Fail'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {records
                      .filter((r) => !getRecordTotalScore(r))
                      .map((record) => (
                        <tr
                          key={record.id}
                          className="hover:bg-muted/30 transition-colors"
                        >
                          <td className="py-2.5 pr-4">
                            <div>
                              <p className="font-medium">
                                {record.studentId ?? 'Unknown'}
                              </p>
                              {record.studentName && (
                                <p className="text-muted-foreground">
                                  {record.studentName}
                                </p>
                              )}
                            </div>
                          </td>
                          <td className="text-muted-foreground py-2.5 pr-4">
                            {new Date(record.timestamp).toLocaleDateString()}
                          </td>
                          <td className="text-muted-foreground py-2.5 pr-4 text-right">
                            —
                          </td>
                          <td className="py-2.5 text-right">
                            <span className="text-muted-foreground text-[10px]">
                              No data
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

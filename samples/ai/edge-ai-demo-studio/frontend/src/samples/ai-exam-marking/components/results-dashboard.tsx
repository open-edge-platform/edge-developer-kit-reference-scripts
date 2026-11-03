// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { ReactNode } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Users,
  TrendingUp,
  AlertCircle,
  Award,
  BookOpen,
  type LucideIcon,
} from 'lucide-react'
import { EmptyState } from '@/components/common/empty-state'
import { TONES, type Tone } from '@/components/common/tones'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import {
  getRecordTotalScore,
  type DashboardStats,
} from '@/samples/ai-exam-marking/lib/dashboard-stats'
import { isPass, PASS_MARK_PCT } from '@/samples/ai-exam-marking/lib/marks'
import type { SavedRecord } from '@/samples/ai-exam-marking/lib/types'

interface ResultsDashboardProps {
  records: SavedRecord[]
  stats: DashboardStats | null
}

/** Bar colour of a question's average: good, fair, weak, poor. */
function averageTone(pct: number): Tone {
  if (pct >= 75) return 'success'
  if (pct >= PASS_MARK_PCT) return 'primary'
  if (pct >= 25) return 'warning'
  return 'destructive'
}

function KpiCard({
  label,
  value,
  icon: Icon,
  tone = 'primary',
}: {
  label: string
  value: ReactNode
  icon: LucideIcon
  tone?: Tone
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-muted-foreground text-xs font-medium">{label}</p>
            <p className="mt-1 text-3xl font-bold">{value}</p>
          </div>
          <div className={cn('rounded-full p-2', TONES[tone].iconBg)}>
            <Icon className={cn('h-5 w-5', TONES[tone].text)} aria-hidden />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function StudentRow({ record, pct }: { record: SavedRecord; pct?: number }) {
  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="py-2.5 pr-4">
        <div>
          <p className="font-medium">{record.studentId ?? 'Unknown'}</p>
          {record.studentName && (
            <p className="text-muted-foreground">{record.studentName}</p>
          )}
        </div>
      </td>
      <td className="text-muted-foreground py-2.5 pr-4">
        {new Date(record.timestamp).toLocaleDateString()}
      </td>
      {pct !== undefined ? (
        <>
          <td className="py-2.5 pr-4 text-right font-medium">{pct}%</td>
          <td className="py-2.5 text-right">
            <Badge
              tone={isPass(pct) ? 'success' : 'destructive'}
              className="text-[10px] font-semibold"
            >
              {isPass(pct) ? 'Pass' : 'Fail'}
            </Badge>
          </td>
        </>
      ) : (
        <>
          <td className="text-muted-foreground py-2.5 pr-4 text-right">—</td>
          <td className="py-2.5 text-right">
            <span className="text-muted-foreground text-[10px]">No data</span>
          </td>
        </>
      )}
    </tr>
  )
}

export function ResultsDashboard({ records, stats }: ResultsDashboardProps) {
  // `stats` is null exactly when there are no records.
  if (records.length === 0 || !stats) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Results Dashboard</CardTitle>
          <CardDescription className="text-xs">
            No grading records available yet
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={BookOpen}
            size="sm"
            className="py-12"
            description="Grade some answer sheets first, then come back to view statistics."
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          label="Total Students"
          value={stats.totalStudents}
          icon={Users}
        />
        <KpiCard
          label="Class Average"
          value={stats.averagePct !== null ? `${stats.averagePct}%` : '—'}
          icon={TrendingUp}
        />
        <KpiCard
          label={`Pass Rate (≥${PASS_MARK_PCT}%)`}
          value={stats.passRate !== null ? `${stats.passRate}%` : '—'}
          icon={Award}
          tone="success"
        />
        <KpiCard
          label="Human Review"
          value={stats.humanReviewCount}
          icon={AlertCircle}
          tone="warning"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
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
                      <Progress
                        value={barPercent(bucket.count, stats.maxBucketCount)}
                        aria-label={`Students scoring ${bucket.label}`}
                      />
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

        {stats.questionStats.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Per-Question Average</CardTitle>
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
                        <Progress
                          value={barPercent(q.avgPct, 100)}
                          aria-label={`${q.label} average`}
                          indicatorClassName={TONES[averageTone(q.avgPct)].dot}
                        />
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
                  <StudentRow key={record.id} record={record} pct={pct} />
                ))}
                {records
                  .filter((r) => !getRecordTotalScore(r))
                  .map((record) => (
                    <StudentRow key={record.id} record={record} />
                  ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/** A bar's fill: `count` of `max`, never thinner than a sliver when above zero. */
function barPercent(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0
  return Math.max(2, Math.round((count / max) * 100))
}

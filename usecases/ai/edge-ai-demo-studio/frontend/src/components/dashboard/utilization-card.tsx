// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { LucideIcon } from 'lucide-react'

const formatTime = (date: Date): string => {
  return date.toLocaleTimeString([], { hour12: true }).toLowerCase()
}

function TrendGraph({
  points,
  colorClass,
}: {
  points: number[]
  colorClass: string
}) {
  if (points.length < 2) {
    return <div className="bg-muted/30 h-18 w-full rounded-lg" />
  }

  const width = 200
  const height = 40
  const step = width / Math.max(points.length - 1, 1)
  const linePoints = points
    .map((value, index) => {
      const x = index * step
      const y = height - (Math.max(0, Math.min(100, value)) / 100) * height
      return `${x},${y}`
    })
    .join(' ')
  const areaPoints = `0,${height} ${linePoints} ${width},${height}`

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`h-18 w-full ${colorClass}`}
    >
      <polygon points={areaPoints} className="fill-current opacity-10" />
      <polyline
        points={linePoints}
        fill="none"
        className="stroke-current"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function UtilizationCard({
  label,
  value,
  icon: Icon,
  colorClass,
  history,
  updatedAt,
  intervalSeconds = 10,
}: {
  label: string
  value: number | null
  icon: LucideIcon
  colorClass: string
  history?: number[]
  updatedAt?: string
  intervalSeconds?: number
}) {
  const trend = history ?? []

  const latestTick = updatedAt ? new Date(updatedAt) : new Date()
  const previousTick = new Date(latestTick.getTime() - intervalSeconds * 1000)

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${colorClass}`} />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <span className={`text-lg font-semibold ${colorClass}`}>
          {value === null ? 'N/A' : `${Math.round(value)}%`}
        </span>
      </div>

      <TrendGraph points={trend} colorClass={colorClass} />

      <div className="mt-2 flex items-center justify-between text-xs">
        <p className="text-muted-foreground">{formatTime(previousTick)}</p>
        <p className="text-muted-foreground">{formatTime(latestTick)}</p>
      </div>
    </div>
  )
}

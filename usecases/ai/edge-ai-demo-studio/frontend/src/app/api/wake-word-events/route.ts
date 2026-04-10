// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface StoredEvent {
  event: string
  model: string
  score: number
  timestamp: string
  message: string
  receivedAt: number
}

const MAX_EVENTS = 200
const events: StoredEvent[] = []

/**
 * POST /api/wake-word-events
 *
 * Local webhook receiver for the wake-word-detection worker.
 * The worker sends detection events here when a wake word is detected.
 */
export async function POST(request: Request) {
  const body = await request.json()
  events.unshift({ ...body, receivedAt: Date.now() })
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS
  return NextResponse.json({ ok: true })
}

/**
 * GET /api/wake-word-events?since=<timestamp>
 *
 * Returns detection events received since the given timestamp.
 * Used by the frontend to poll for new detection events.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const since = Number(url.searchParams.get('since') ?? 0)
  const recent = since > 0 ? events.filter((e) => e.receivedAt > since) : events
  return NextResponse.json({ events: recent })
}

/**
 * DELETE /api/wake-word-events
 *
 * Clears all stored detection events.
 */
export async function DELETE() {
  events.length = 0
  return NextResponse.json({ ok: true })
}

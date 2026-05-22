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

export async function POST(request: Request) {
  const body = await request.json()
  events.unshift({ ...body, receivedAt: Date.now() })
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS
  return NextResponse.json({ ok: true })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const since = Number(url.searchParams.get('since') ?? 0)
  const recent = since > 0 ? events.filter((e) => e.receivedAt > since) : events
  return NextResponse.json({ events: recent })
}

export async function DELETE() {
  events.length = 0
  return NextResponse.json({ ok: true })
}

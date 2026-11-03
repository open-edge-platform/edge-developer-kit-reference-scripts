// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from 'next/server'
import { jsonErrorFrom } from '@/lib/api/json'
import { getSystemOverview } from '@/lib/system/system-monitoring'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** `SystemMonitoringOverview`: CPU, memory, GPUs, NPU and their history. */
export async function GET() {
  try {
    return NextResponse.json(await getSystemOverview())
  } catch (error) {
    return jsonErrorFrom(error, 'Failed to fetch system monitoring metrics')
  }
}

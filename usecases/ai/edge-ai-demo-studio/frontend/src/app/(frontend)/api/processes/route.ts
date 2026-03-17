// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from 'next/server'
import { listProcesses } from '@/lib/process-handler'
import { logger } from '@/utils/logger'

interface ProcessInfo {
  name: string
  status: 'active' | 'error' | 'stopped'
  pid: number | undefined
  startTime: Date
}

interface ProcessListResponse {
  processes: ProcessInfo[]
  count: number
}

export async function GET() {
  try {
    const processes = listProcesses()

    const processResponse: ProcessListResponse = {
      processes,
      count: processes.length,
    }

    return NextResponse.json(processResponse)
  } catch (error) {
    logger.error('Error fetching process list:', error)

    let errorMessage = 'Failed to fetch process list'
    if (error instanceof Error) {
      errorMessage = error.message
    }

    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

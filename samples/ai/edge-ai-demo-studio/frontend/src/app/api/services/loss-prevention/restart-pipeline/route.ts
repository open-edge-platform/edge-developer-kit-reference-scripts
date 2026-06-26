// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { WORKER_DIR } from '@/lib/constants'
import { logger } from '@/lib/logger'
import { runProcessCommand } from '@/lib/process-handler'

export const dynamic = 'force-dynamic'

const isWindows = process.platform === 'win32'
const LP_WORKER_DIR = path.join(
  WORKER_DIR,
  'suite/retail-ai-suite/loss-prevention',
)

export async function POST() {
  const scriptName = isWindows ? 'restart-pipeline.ps1' : 'restart-pipeline.sh'
  const scriptPath = path.join(LP_WORKER_DIR, scriptName)

  if (!fs.existsSync(scriptPath)) {
    logger.error(`[loss-prevention] Restart script not found: ${scriptPath}`)
    return NextResponse.json(
      { ok: false, error: 'Restart script not found' },
      { status: 500 },
    )
  }

  const ok = await runProcessCommand(
    'loss-prevention',
    isWindows
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
      : [scriptPath],
    {
      command: isWindows ? 'powershell' : 'bash',
      cwd: LP_WORKER_DIR,
    },
  )

  if (!ok) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Restart command failed — check service logs for details',
      },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { jsonError, jsonErrorFrom } from '@/lib/api/json'
import { getInstanceProcessName } from '@/lib/instances/instances'
import { logger } from '@/lib/logger'
import { getWorkloadInstance } from '@/lib/workers/instance-lookup'
import { runProcessCommand } from '@/lib/workers/process-handler'
import { resolveWorkerDir } from '@/lib/workers/worker-dir'

export const dynamic = 'force-dynamic'

const isWindows = process.platform === 'win32'

/**
 * Restarts the Loss Prevention suite's pipeline with its worker's restart
 * script; the script's output goes into the instance's log.
 */
export async function POST() {
  try {
    const row = await getWorkloadInstance('loss-prevention')
    const workerDir = resolveWorkerDir(row)
    const scriptPath = path.join(
      workerDir,
      isWindows ? 'restart-pipeline.ps1' : 'restart-pipeline.sh',
    )
    if (!fs.existsSync(scriptPath)) {
      logger.error(`[loss-prevention] Restart script not found: ${scriptPath}`)
      return jsonError(500, 'Restart script not found')
    }

    const ok = await runProcessCommand(
      getInstanceProcessName(row),
      isWindows
        ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
        : [scriptPath],
      { command: isWindows ? 'powershell' : 'bash', cwd: workerDir },
    )
    if (!ok) {
      return jsonError(
        500,
        'Restart command failed — check service logs for details',
      )
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonErrorFrom(error, 'Failed to restart the pipeline')
  }
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import config from '@payload-config'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { z } from 'zod'
import { jsonError } from '@/lib/api/json'
import { writeDeploymentConfig } from '@/lib/deployment/deployment-file'
import { snapshotDeploymentConfig } from '@/lib/deployment/deployment-snapshot'
import { getErrorMessage } from '@/lib/errors'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

/** GET → `DeploymentSnapshot`: the current services as a deployment.json document. */
export async function GET() {
  try {
    const payload = await getPayload({ config })
    return NextResponse.json(await snapshotDeploymentConfig(payload))
  } catch (error) {
    logger.error('Failed to build deployment snapshot:', error)
    return jsonError(500, 'Failed to build the deployment snapshot')
  }
}

/**
 * What the dialog showed: the document it summarised (`expected`) and whether it warned of
 * replacing a file (`overwrite`). Both optional, so a bare POST saves the current snapshot.
 */
const saveSchema = z.object({
  expected: z.unknown().optional(),
  overwrite: z.boolean().optional(),
})

/** The request's JSON body, `{}` when it has none. */
async function readSaveRequest(
  request: Request,
): Promise<z.infer<typeof saveSchema> | null> {
  const text = await request.text()
  if (!text.trim()) return {}
  try {
    const parsed = saveSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Writes the snapshot to the startup deployment.json. If it changed since what the body says was
 * reviewed, nothing is written: 409 with the current snapshot.
 */
export async function POST(request: Request) {
  const body = await readSaveRequest(request)
  if (!body) {
    return jsonError(400, 'Expected { expected?, overwrite?: boolean }')
  }

  let filePath: string | undefined
  try {
    const payload = await getPayload({ config })
    const snapshot = await snapshotDeploymentConfig(payload)
    filePath = snapshot.filePath
    const changed =
      (body.expected !== undefined &&
        JSON.stringify(body.expected) !== JSON.stringify(snapshot.config)) ||
      (body.overwrite !== undefined && body.overwrite !== snapshot.exists)
    if (changed) {
      return jsonError(
        409,
        'The services changed after this summary was loaded. Review the updated summary, then save again.',
        { snapshot },
      )
    }
    writeDeploymentConfig(snapshot.config, filePath)
    return NextResponse.json({ ...snapshot, exists: true })
  } catch (error) {
    logger.error(`Failed to save deployment.json to ${filePath}:`, error)
    return jsonError(
      500,
      `Failed to save deployment.json: ${getErrorMessage(error)}`,
    )
  }
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { promises as fsPromises } from 'node:fs'
import path from 'node:path'
import config from '@payload-config'
import { type NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { MODELS_DIR } from '@/lib/constants'
import { logger } from '@/lib/logger'
import { getWorkerConfig } from '@/services/worker-registry'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const numericId = Number(id)
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: 'Invalid service ID' }, { status: 400 })
  }

  const payload = await getPayload({ config })

  const service = await payload.findByID({
    collection: 'services',
    id: numericId,
  })

  if (!service) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 })
  }

  // Only allow clearing models when the service is stopped
  if (service.status !== 'inactive') {
    return NextResponse.json(
      { error: 'Service must be stopped before clearing model cache' },
      { status: 409 },
    )
  }

  const workerConfig = getWorkerConfig(service.type)
  if (!workerConfig?.modelDirectories?.length) {
    return NextResponse.json(
      { error: 'This service does not have any model directories configured' },
      { status: 400 },
    )
  }

  // MODELS_DIR is <project_root>/models — resolve relative paths from its parent
  const projectRoot = path.resolve(MODELS_DIR, '..')
  const cleared: string[] = []
  const errors: string[] = []

  for (const dir of workerConfig.modelDirectories) {
    const resolved = path.resolve(projectRoot, dir)

    // Ensure the resolved path is within the project root (prevent path traversal)
    if (!resolved.startsWith(projectRoot)) {
      errors.push(`${dir}: path traversal detected`)
      continue
    }

    try {
      await fsPromises.rm(resolved, { recursive: true, force: true })
      cleared.push(dir)
      logger.info(`Cleared model cache directory: ${resolved}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`${dir}: ${message}`)
      logger.error(`Failed to clear model cache directory ${resolved}:`, err)
    }
  }

  return NextResponse.json({ cleared, errors })
}

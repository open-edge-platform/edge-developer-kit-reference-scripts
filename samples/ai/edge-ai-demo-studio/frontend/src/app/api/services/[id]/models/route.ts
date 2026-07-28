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

// MODELS_DIR is <project_root>/models — resolve relative paths from its parent
const PROJECT_ROOT = path.resolve(MODELS_DIR, '..')

/**
 * Resolves a worker-relative model directory to an absolute path, ensuring it
 * stays within the project root (prevents path traversal). Returns null if
 * the resolved path escapes the project root.
 */
function resolveModelDir(dir: string): string | null {
  const resolved = path.resolve(PROJECT_ROOT, dir)
  const rel = path.relative(PROJECT_ROOT, resolved)
  const escapesRoot =
    rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)
  return escapesRoot ? null : resolved
}

export async function GET(
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

  const workerConfig = getWorkerConfig(service.type)
  if (!workerConfig?.modelDirectories?.length) {
    return NextResponse.json({ downloaded: true })
  }

  for (const dir of workerConfig.modelDirectories) {
    const resolved = resolveModelDir(dir)
    if (!resolved) {
      logger.error(`Path traversal detected while checking model dir: ${dir}`)
      return NextResponse.json({ downloaded: false })
    }

    try {
      const entries = await fsPromises.readdir(resolved)
      if (entries.length === 0) {
        return NextResponse.json({ downloaded: false })
      }
    } catch {
      // Directory doesn't exist yet — model hasn't been downloaded
      return NextResponse.json({ downloaded: false })
    }
  }

  return NextResponse.json({ downloaded: true })
}

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

  const cleared: string[] = []
  const errors: string[] = []

  for (const dir of workerConfig.modelDirectories) {
    const resolved = resolveModelDir(dir)

    // Ensure the resolved path is within the project root (prevent path traversal)
    if (!resolved) {
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

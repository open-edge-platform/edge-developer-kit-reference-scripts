// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ZipArchive } from 'archiver'
import { type NextRequest, NextResponse } from 'next/server'
import {
  buildExportBundle,
  cleanupBundle,
  ExportError,
  exportFileName,
  parseSampleIds,
  resolveExportPlan,
} from '@/lib/export-samples'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
// Exports can take a while (codegen runs in the exported tree).
export const maxDuration = 300

function errorResponse(err: unknown) {
  if (err instanceof ExportError) {
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
  logger.error('Export route error:', err)
  return NextResponse.json(
    { error: 'Unexpected error while exporting samples' },
    { status: 500 },
  )
}

function parseIncludeOptional(value: string | null | undefined): boolean {
  // Default OFF: produce the slimmest bundle unless the caller opts in.
  return value === 'true' || value === '1'
}

/** GET /api/export-samples?samples=a,b&includeOptional=false → resolved plan. */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const sampleIds = parseSampleIds(searchParams.get('samples'))
    const includeOptional = parseIncludeOptional(
      searchParams.get('includeOptional'),
    )
    const plan = await resolveExportPlan(sampleIds, includeOptional)
    return NextResponse.json(plan)
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * Zip a directory tree into a single Buffer, nesting its contents under a
 * single top-level `rootDir` folder so the archive unpacks into one folder
 * rather than spilling files into the current directory.
 */
function zipDirectory(dir: string, rootDir: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } })
    const chunks: Buffer[] = []
    archive.on('data', (chunk: Buffer) => chunks.push(chunk))
    archive.on('warning', (warn) => logger.warn?.(`zip warning: ${warn}`))
    archive.on('error', reject)
    archive.on('end', () => resolve(Buffer.concat(chunks)))
    // Place the directory contents under `rootDir/` inside the zip.
    archive.directory(dir, rootDir)
    archive.finalize()
  })
}

/** POST /api/export-samples { samples, includeOptional } → zip download. */
export async function POST(request: NextRequest) {
  let bundleTmpDir: string | undefined
  try {
    const body = (await request.json().catch(() => ({}))) as {
      samples?: unknown
      includeOptional?: unknown
    }
    const sampleIds = parseSampleIds(body.samples)
    const includeOptional = body.includeOptional === true

    const { outDir, tmpDir } = await buildExportBundle(
      sampleIds,
      includeOptional,
    )
    bundleTmpDir = tmpDir

    const fileName = exportFileName(sampleIds)
    // Use the zip's base name (sans `.zip`) as the single wrapping folder.
    const rootDir = fileName.replace(/\.zip$/, '')
    const zip = await zipDirectory(outDir, rootDir)

    return new NextResponse(new Uint8Array(zip), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': String(zip.byteLength),
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return errorResponse(err)
  } finally {
    if (bundleTmpDir) await cleanupBundle(bundleTmpDir)
  }
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type NextRequest, NextResponse } from 'next/server'
import { jsonErrorFrom } from '@/lib/api/json'
import {
  buildExportBundle,
  cleanupBundle,
  type ExportDone,
  ExportError,
  exportFileName,
  type ExportSelection,
  parseExportSelection,
  resolveExportPlan,
} from '@/lib/deployment/export-bundle'
import {
  bundleDownloadPath,
  bundleZipResponse,
  registerBundleDownload,
} from '@/lib/deployment/export-bundle-download'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const UNEXPECTED = 'Unexpected error while exporting samples'

function errorResponse(err: unknown) {
  return jsonErrorFrom(err, UNEXPECTED, 'Export route error')
}

function parseIncludeOptional(value: string | null | undefined): boolean {
  // Default OFF: produce the slimmest bundle unless the caller opts in.
  return value === 'true' || value === '1'
}

/** GET /api/export-bundle?samples=a,b&services=c&includeOptional=false → resolved plan. */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const selection = parseExportSelection(
      searchParams.get('samples'),
      searchParams.get('services'),
    )
    const includeOptional = parseIncludeOptional(
      searchParams.get('includeOptional'),
    )
    const plan = await resolveExportPlan(selection, includeOptional)
    return NextResponse.json(plan)
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * POST { samples, services, includeOptional }. With `Accept: text/event-stream` it streams
 * `progress` `{ phase, message }`, then `done` `{ downloadId, fileName, url, expiresAt }` or `error`
 * `{ error }`; closing the stream cancels the export. Otherwise it answers with the zip itself.
 */
export async function POST(request: NextRequest) {
  let selection: ExportSelection
  let includeOptional: boolean
  try {
    const body = (await request.json().catch(() => ({}))) as {
      samples?: unknown
      services?: unknown
      includeOptional?: unknown
    }
    selection = parseExportSelection(body.samples, body.services)
    includeOptional = body.includeOptional === true
  } catch (err) {
    return errorResponse(err)
  }

  if (request.headers.get('accept')?.includes('text/event-stream')) {
    return exportEventStream(request, selection, includeOptional)
  }

  try {
    const bundle = await buildExportBundle(selection, includeOptional, {
      signal: request.signal,
    })
    return bundleZipResponse(bundle, exportFileName(selection))
  } catch (err) {
    return errorResponse(err)
  }
}

const encoder = new TextEncoder()
const KEEPALIVE = encoder.encode(': keep-alive\n\n')
const KEEPALIVE_MS = 15_000

function sseEvent(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/** Runs the export, relaying its output as events (see `POST`). */
function exportEventStream(
  request: NextRequest,
  selection: ExportSelection,
  includeOptional: boolean,
): Response {
  const abort = new AbortController()
  const cancel = () => abort.abort()
  request.signal.addEventListener('abort', cancel, { once: true })

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true
      const send = (chunk: Uint8Array) => {
        if (!open) return
        try {
          controller.enqueue(chunk)
        } catch {
          open = false
        }
      }
      // Copying and codegen can go quiet for a while; a comment line keeps
      // any proxy in between from treating the stream as idle.
      const keepAlive = setInterval(() => send(KEEPALIVE), KEEPALIVE_MS)

      try {
        const bundle = await buildExportBundle(selection, includeOptional, {
          signal: abort.signal,
          onProgress: (progress) => send(sseEvent('progress', progress)),
        })
        if (abort.signal.aborted) {
          await cleanupBundle(bundle.tmpDir)
          return
        }
        const fileName = exportFileName(selection)
        const { id: downloadId, expiresAt } = registerBundleDownload(
          bundle,
          fileName,
        )
        const done: ExportDone = {
          downloadId,
          fileName,
          url: bundleDownloadPath(downloadId),
          expiresAt,
        }
        send(sseEvent('done', done))
      } catch (err) {
        if (!(err instanceof ExportError)) {
          logger.error('Export route error:', err)
        }
        send(
          sseEvent('error', {
            error: err instanceof ExportError ? err.message : UNEXPECTED,
          }),
        )
      } finally {
        clearInterval(keepAlive)
        request.signal.removeEventListener('abort', cancel)
        if (open) {
          open = false
          try {
            controller.close()
          } catch {
            // Already cancelled by the client.
          }
        }
      }
    },
    cancel,
  })

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

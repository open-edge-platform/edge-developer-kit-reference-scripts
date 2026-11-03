// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type NextRequest, NextResponse } from 'next/server'
import { ApiError } from '@/lib/api/errors'
import { jsonError, jsonErrorFrom } from '@/lib/api/json'
import { safeUrl, URL_CHARS } from '@/lib/validation'
import { getWorkloadEndpoint } from '@/lib/workers/instance-lookup'
import { createStallWatchdog } from '@/lib/workers/stall-watchdog'
import {
  untimedDispatcher,
  type WorkerRequestInit,
} from '@/lib/workers/untimed-dispatcher'

// The sample's allow-listing proxy to the ppt-translator worker, under /api/samples so it never
// collides with /api/<type>@<instanceId>. The base URL is resolved per request from the service
// row, never from the client; unlike the instance proxy, only the sample's own calls pass.

type Params = { params: Promise<{ path: string[] }> }

/** The endpoints let through, with how many path segments each takes. */
const ENDPOINT_MAX_SEGMENTS: Record<string, number> = {
  healthcheck: 1,
  translate: 1,
  status: 3,
  download: 2,
}

/** Allowed trailing segments after `<endpoint>/<id>`. */
const ENDPOINT_SUFFIXES: Record<string, ReadonlySet<string>> = {
  status: new Set(['events']),
}

const ALLOWED_HEADERS = ['content-type', 'accept', 'accept-language']

/** Response headers passed back to the browser as they are. */
const PASSED_RESPONSE_HEADERS = ['content-type', 'cache-control']

/**
 * How long the call may go without moving a byte either way; not a whole-call limit. The status
 * event stream sends a keep-alive every 15 s.
 */
const STALL_TIMEOUT_MS = 60_000

/** The worker path for `segments`; throws a 400/404 `ApiError` for anything not let through. */
function resolveTargetPath(segments: string[]): string {
  if (segments.length === 0) throw new ApiError(400, 'Empty path')
  if (!segments.every((seg) => /^[a-zA-Z0-9_-]+$/.test(seg))) {
    throw new ApiError(400, 'Invalid path segment')
  }

  const [endpoint] = segments
  const maxSegments = Object.hasOwn(ENDPOINT_MAX_SEGMENTS, endpoint)
    ? ENDPOINT_MAX_SEGMENTS[endpoint]
    : 0
  if (maxSegments === 0) throw new ApiError(404, 'Endpoint not allowed')
  if (segments.length > maxSegments) {
    throw new ApiError(400, 'Too many path segments')
  }
  if (segments.length > 2 && !ENDPOINT_SUFFIXES[endpoint]?.has(segments[2])) {
    throw new ApiError(404, 'Endpoint not allowed')
  }
  return segments.join('/')
}

async function proxy(
  request: NextRequest,
  segments: string[],
): Promise<Response> {
  const targetPath = resolveTargetPath(segments)
  const { baseUrl } = await getWorkloadEndpoint('ppt-translator')
  let target = ''
  for (const ch of safeUrl(`${baseUrl}/${targetPath}`)) {
    let ok = ''
    for (const allowed of URL_CHARS)
      if (allowed === ch) {
        ok = allowed
        break
      }
    if (!ok) throw new ApiError(400, 'Invalid path')
    target += ok
  }

  const jobSegment = segments[1] ?? null

  const headers = Object.fromEntries(
    [...request.headers].filter(([key]) =>
      ALLOWED_HEADERS.includes(key.toLowerCase()),
    ),
  )

  // Aborted when nothing moved for STALL_TIMEOUT_MS, or when the browser
  // goes away (which also ends a status stream on the worker).
  const watchdog = createStallWatchdog({
    timeoutMs: STALL_TIMEOUT_MS,
    stalledError: () =>
      new Error(`No data for ${STALL_TIMEOUT_MS / 1000} s from the worker`),
    clientSignal: request.signal,
  })

  // The upload streams straight through (multipart boundary and all) rather
  // than being read into memory first.
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const init: WorkerRequestInit = {
    method: request.method,
    headers,
    body: hasBody && request.body ? watchdog.watch(request.body) : null,
    // Required by Node's fetch when streaming a request body.
    duplex: 'half',
    dispatcher: untimedDispatcher,
    signal: watchdog.signal,
  }

  let response: Response
  try {
    response = await fetch(target, init)
  } catch (error) {
    watchdog.stop()
    if (watchdog.stalled) {
      return jsonError(504, 'The PPT Translator worker stopped responding')
    }
    throw new ApiError(502, 'The PPT Translator worker is not reachable', {
      cause: error,
    })
  }
  watchdog.touch()

  const contentType = response.headers.get('content-type') ?? ''
  const streamed =
    contentType.includes('application/vnd.openxmlformats') ||
    contentType.includes('text/event-stream')

  if (streamed && response.body) {
    const passed = new Headers()
    for (const name of PASSED_RESPONSE_HEADERS) {
      const value = response.headers.get(name)
      if (value) passed.set(name, value)
    }
    if (contentType.includes('text/event-stream')) {
      // Keep any proxy in front of the app from holding events back.
      passed.set('X-Accel-Buffering', 'no')
    } else {
      const safeId = (jobSegment ?? 'translated').replace(/[^a-zA-Z0-9_-]/g, '')
      passed.set(
        'Content-Disposition',
        `attachment; filename="translated_${safeId}.pptx"`,
      )
      // fetch hands back a decoded body, so a length only holds unencoded.
      const length = response.headers.get('content-length')
      if (length && !response.headers.get('content-encoding')) {
        passed.set('Content-Length', length)
      }
    }
    return new Response(watchdog.watch(response.body, { endsCall: true }), {
      status: response.status,
      headers: passed,
    })
  }

  // JSON answers (job created, status, health, errors) are small.
  try {
    const text = await response.text()
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      data = { status: text }
    }
    return NextResponse.json(data, { status: response.status })
  } finally {
    watchdog.stop()
  }
}

async function handle(request: NextRequest, { params }: Params) {
  try {
    const { path } = await params
    return await proxy(request, path)
  } catch (error) {
    return jsonErrorFrom(error, 'PPT Translator proxy failed')
  }
}

export const GET = handle
export const POST = handle

/** Cancelling a job — `DELETE status/<id>` — is the only DELETE let through. */
export async function DELETE(request: NextRequest, context: Params) {
  const { path } = await context.params
  if (path.length !== 2 || path[0] !== 'status') {
    return jsonError(405, 'Endpoint not allowed')
  }
  return handle(request, context)
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type NextRequest, NextResponse } from 'next/server'
import { service } from '@/services/ppt-translator/data'

const WORKER_PORT = service.port
const TRUSTED_BASE = `http://127.0.0.1:${WORKER_PORT}` as const

const ALLOWED_ENDPOINTS = new Map<string, string>([
  ['healthcheck', `${TRUSTED_BASE}/healthcheck`],
  ['translate', `${TRUSTED_BASE}/translate`],
  ['status', `${TRUSTED_BASE}/status`],
  ['download', `${TRUSTED_BASE}/download`],
])

const ENDPOINT_MAX_SEGMENTS: Record<string, number> = {
  healthcheck: 1,
  translate: 1,
  status: 2,
  download: 2,
}

const ALLOWED_HEADERS = ['content-type', 'accept', 'accept-language']

function resolveTarget(segments: string[]): {
  url: string
  extraSegment: string | null
} {
  if (!segments.length) {
    throw new Error('Empty path')
  }

  for (const seg of segments) {
    if (!/^[a-zA-Z0-9_-]+$/.test(seg)) {
      throw new Error('Invalid path segment')
    }
  }

  const base = ALLOWED_ENDPOINTS.get(segments[0])
  if (!base) throw new Error('Endpoint not allowed')

  const maxSegments = ENDPOINT_MAX_SEGMENTS[segments[0]] ?? 1
  if (segments.length > maxSegments) {
    throw new Error('Too many path segments')
  }

  return { url: base, extraSegment: segments[1] ?? null }
}

async function proxy(
  request: NextRequest,
  segments: string[],
): Promise<Response> {
  const { url, extraSegment } = resolveTarget(segments)
  const targetUrl = extraSegment ? `${url}/${extraSegment}` : url

  const isFormData = request.headers
    .get('content-type')
    ?.includes('multipart/form-data')

  const body =
    request.method === 'GET'
      ? undefined
      : isFormData
        ? await request.formData()
        : await request.blob()

  const filteredHeaders = Object.fromEntries(
    Object.entries(Object.fromEntries(request.headers)).filter(([key]) =>
      ALLOWED_HEADERS.includes(key.toLowerCase()),
    ),
  )

  const response = await fetch(targetUrl, {
    method: request.method,
    headers: isFormData ? undefined : filteredHeaders,
    body,
    signal: AbortSignal.timeout(30000),
  })

  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/vnd.openxmlformats')) {
    const buffer = await response.arrayBuffer()
    const safeId = (extraSegment ?? 'translated').replace(/[^a-zA-Z0-9_-]/g, '')
    return new NextResponse(buffer, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="translated_${safeId}.pptx"`,
        'Content-Length': buffer.byteLength.toString(),
      },
    })
  }

  const text = await response.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    data = { status: text }
  }

  return NextResponse.json(data, { status: response.status })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await params
    return await proxy(request, path)
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Service unavailable',
      },
      { status: 503 },
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await params
    return await proxy(request, path)
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Service unavailable',
      },
      { status: 500 },
    )
  }
}

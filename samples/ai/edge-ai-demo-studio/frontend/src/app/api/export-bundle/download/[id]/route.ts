// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { jsonError } from '@/lib/api/json'
import {
  bundleDownloadResponse,
  hasBundleDownload,
} from '@/lib/deployment/export-bundle-download'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const EXPIRED = 'This export has expired: export again to rebuild it'

/** The zip of an export from `POST /api/export-bundle`, downloadable until its `expiresAt`. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params
  return bundleDownloadResponse(id) ?? jsonError(404, EXPIRED)
}

/** HEAD: whether the zip can still be downloaded (200) or expired (404). */
export async function HEAD(_request: Request, { params }: Params) {
  const { id } = await params
  return new Response(null, {
    status: hasBundleDownload(id) ? 200 : 404,
    headers: { 'Cache-Control': 'no-store' },
  })
}

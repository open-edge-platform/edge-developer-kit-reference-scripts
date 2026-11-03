// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type NextRequest, NextResponse } from 'next/server'
import { jsonError, jsonErrorFrom } from '@/lib/api/json'
import { isServiceType } from '@/lib/instances/service-type'
import {
  clearModelCache,
  isModelCacheDownloaded,
  modelCacheSharedWith,
} from '@/lib/workers/model-cache'

export const dynamic = 'force-dynamic'

/**
 * A service type's whole model cache, whether or not the service has an instance (see
 * `lib/workers/model-cache.ts`). `GET ?type=` answers `{ downloaded, sharedWith }`.
 */
export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get('type')
  if (!isServiceType(type)) return jsonError(400, 'Unknown service type')
  try {
    return NextResponse.json({
      downloaded: await isModelCacheDownloaded(type),
      sharedWith: modelCacheSharedWith(type),
    })
  } catch (error) {
    return jsonErrorFrom(error, 'Failed to check the model cache')
  }
}

/**
 * `DELETE ?type=` clears the type's model folders, answering `{ cleared, errors }`; 409 while an
 * instance using them runs.
 */
export async function DELETE(request: NextRequest) {
  const type = request.nextUrl.searchParams.get('type')
  if (!isServiceType(type)) return jsonError(400, 'Unknown service type')
  try {
    return NextResponse.json(await clearModelCache(type))
  } catch (error) {
    return jsonErrorFrom(
      error,
      'Failed to clear the model cache',
      `Clearing the ${type} model cache failed`,
    )
  }
}

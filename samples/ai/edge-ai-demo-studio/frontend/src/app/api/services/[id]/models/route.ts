// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { type ServiceRow, withServiceRow } from '@/lib/api/service-row'
import {
  isModelCacheDownloaded,
  modelCacheSharedWith,
} from '@/lib/workers/model-cache'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * `{ downloaded, sharedWith }`: whether every model directory has files, and the other services
 * sharing a model folder, whose files clearing removes too. Clearing, and deleting one model, are
 * per type: `/api/services/models/cache` and `DELETE /api/services/models`.
 */
export function GET(_request: NextRequest, { params }: Params) {
  return withServiceRow(params, 'Failed to check the model cache', checkModels)
}

async function checkModels({ service }: ServiceRow): Promise<Response> {
  return NextResponse.json({
    downloaded: await isModelCacheDownloaded(service.type),
    sharedWith: modelCacheSharedWith(service.type),
  })
}

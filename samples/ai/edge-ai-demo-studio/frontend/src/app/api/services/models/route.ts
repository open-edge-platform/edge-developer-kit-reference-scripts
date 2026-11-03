// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type NextRequest, NextResponse } from 'next/server'
import type { BackendId } from '@/engines/multiserve/types'
import { jsonError, jsonErrorFrom } from '@/lib/api/json'
import { isServiceType } from '@/lib/instances/service-type'
import {
  CATALOG_ENGINES,
  type CatalogEngine,
  deleteWorkerModel,
  getModelCatalog,
} from '@/lib/workers/model-catalog'
import { metaMap } from '@/services/_generated/meta'
import { hasExecutionMode } from '@/services/execution'

export const dynamic = 'force-dynamic'

const PROVIDERS: readonly BackendId[] = ['openvino', 'llamacpp']

/** `value` when it is one of `options`, else undefined. */
function oneOf<T extends string>(
  options: readonly T[],
  value: string,
): T | undefined {
  return options.find((option) => option === value)
}

/**
 * Model catalogue scanned from disk without starting anything (New-instance drafts, stopped
 * instances). Params: `type`; optional `instance` (default: the primary), `provider` (multiserve
 * types only) and `engine` (overrides the instance's stored engine, for a cross-engine draft).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const type = searchParams.get('type')
  if (!isServiceType(type)) return jsonError(400, 'Unknown service type')
  const meta = metaMap[type]

  const providerParam = searchParams.get('provider')
  let provider: BackendId | undefined
  if (providerParam !== null) {
    provider = oneOf(PROVIDERS, providerParam)
    if (!provider) {
      return jsonError(400, `Unknown provider "${providerParam}"`)
    }
    if (!hasExecutionMode(meta.execution, 'multiserve')) {
      return jsonError(400, `"${type}" has no multiserve execution mode`)
    }
  }

  const engineParam = searchParams.get('engine')
  let engine: CatalogEngine | undefined
  if (engineParam !== null) {
    engine = oneOf(CATALOG_ENGINES, engineParam)
    if (!engine) return jsonError(400, `Unknown engine "${engineParam}"`)
  }

  try {
    const catalog = await getModelCatalog({
      type,
      instanceKey: searchParams.get('instance') ?? undefined,
      provider,
      engine,
    })
    return NextResponse.json(catalog)
  } catch (error) {
    return jsonErrorFrom(
      error,
      'Failed to read the model catalogue',
      `Model catalogue lookup failed for ${type}`,
    )
  }
}

/**
 * Deletes one worker model from disk (`type`, `model`, optional asking `instance`), instance or not.
 * Answers `{ deleted, errors }`; 404 if nothing is on disk, 409 while an instance using it runs.
 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const type = searchParams.get('type')
  if (!isServiceType(type)) return jsonError(400, 'Unknown service type')
  const model = searchParams.get('model')
  if (model === null) return jsonError(400, 'Missing model')

  try {
    return NextResponse.json(
      await deleteWorkerModel({
        type,
        model,
        instanceKey: searchParams.get('instance') ?? undefined,
      }),
    )
  } catch (error) {
    return jsonErrorFrom(
      error,
      'Failed to delete the model',
      `Deleting ${type} model ${model} failed`,
    )
  }
}

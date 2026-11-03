// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Finds the `services` row and loopback address for a type: the named instance, else the primary. */

import config from '@payload-config'
import { getPayload } from 'payload'
import { engines } from '@/engines/registry'
import { ApiError } from '@/lib/api/errors'
import {
  getInstanceKey,
  parseInstanceKey,
  pickPrimaryInstance,
} from '@/lib/instances/instances'
import { payloadInstancePreference } from '@/lib/instances/service-status'
import { loopbackBaseUrl } from '@/lib/workers/loopback'
import type { Service } from '@/payload-types'
import { metaMap } from '@/services/_generated/meta'

/** Rows of one type a lookup reads; far above any instance cap. */
const MAX_ROWS_PER_TYPE = 100

export type InstanceLookupCode = 'wrong-type' | 'not-found' | 'not-running'

const STATUS: Record<InstanceLookupCode, number> = {
  'wrong-type': 400,
  'not-found': 404,
  'not-running': 503,
}

/** Why a lookup found no instance to use; `code` tells the cases apart without parsing the message. */
class InstanceLookupError extends ApiError {
  readonly code: InstanceLookupCode

  constructor(code: InstanceLookupCode, message: string) {
    super(STATUS[code], message)
    this.name = 'InstanceLookupError'
    this.code = code
  }
}

function serviceName(type: Service['type']): string {
  return metaMap[type]?.name ?? type
}

/**
 * The row `instanceKey` (`type@instanceId`) names, else the type's primary instance. Throws an
 * `InstanceLookupError`: `wrong-type` for a key of another type, `not-found` when there is no row.
 */
export async function getWorkloadInstance(
  workloadType: Service['type'],
  instanceKey?: string,
): Promise<Service> {
  const payload = await getPayload({ config })

  if (instanceKey) {
    const parsed = parseInstanceKey(instanceKey)
    if (!parsed || parsed.type !== workloadType) {
      throw new InstanceLookupError(
        'wrong-type',
        `Instance "${instanceKey}" is not a ${workloadType} instance`,
      )
    }
    const result = await payload.find({
      collection: 'services',
      where: {
        and: [
          { type: { equals: workloadType } },
          { instanceId: { equals: parsed.instanceId } },
        ],
      },
      limit: 1,
    })
    const row = result.docs[0]
    if (!row) {
      throw new InstanceLookupError(
        'not-found',
        `No ${workloadType} instance "${instanceKey}" found`,
      )
    }
    return row
  }

  const primary = await findPrimaryInstance(workloadType)
  if (!primary) {
    throw new InstanceLookupError(
      'not-found',
      `${serviceName(workloadType)} is not added yet`,
    )
  }
  return primary
}

/** The type's primary instance (see `pickPrimaryInstance`), or undefined. */
export async function findPrimaryInstance(
  workloadType: Service['type'],
): Promise<Service | undefined> {
  const payload = await getPayload({ config })
  const rows = await payload.find({
    collection: 'services',
    where: { type: { equals: workloadType } },
    sort: 'id',
    limit: MAX_ROWS_PER_TYPE,
  })
  return pickPrimaryInstance(rows.docs, (d) =>
    payloadInstancePreference(d.status),
  )
}

/**
 * The instance a request body's `instances` field (`{ [type]: "type@instanceId" }`) binds `type`
 * to. `undefined` when absent, malformed or of another type, so a stale binding falls back to the
 * primary instance instead of failing the request.
 */
export function boundInstanceKey(
  instances: unknown,
  type: Service['type'],
): string | undefined {
  if (!instances || typeof instances !== 'object') return undefined
  const key = (instances as Record<string, unknown>)[type]
  if (typeof key !== 'string') return undefined
  return parseInstanceKey(key)?.type === type ? key : undefined
}

/**
 * Loopback base URL and instance key of a running workload. Ports are allocated at start, so this
 * throws a `not-running` `InstanceLookupError` while it is stopped.
 */
export async function getWorkloadEndpoint(
  workloadType: Service['type'],
  instanceKey?: string,
): Promise<{ baseUrl: string; instanceKey: string; row: Service }> {
  const row = await getWorkloadInstance(workloadType, instanceKey)
  if (row.port == null) {
    throw new InstanceLookupError(
      'not-running',
      `${serviceName(workloadType)} is not running`,
    )
  }
  return {
    baseUrl: loopbackBaseUrl(row.port),
    instanceKey: getInstanceKey(row),
    row,
  }
}

/**
 * Model name and base URL for OpenAI-style calls: an engine row's inference name
 * (`openvino:<repo>`), or a worker's stored model name.
 */
export async function resolveWorkload(
  workloadType: Service['type'],
  instanceKey?: string,
): Promise<{ model: string; baseUrl: string }> {
  const { baseUrl, row } = await getWorkloadEndpoint(workloadType, instanceKey)
  const engine = engines[row.engine]
  const model = engine
    ? engine.getModelName(row.models.default, true)
    : row.models.default.name
  return { model, baseUrl }
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import config from '@payload-config'
import { type NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { getBackendByValue } from '@/engines/registry'

export const dynamic = 'force-dynamic'

const VALID_ACTIONS = ['start', 'stop', 'restart'] as const
type Action = (typeof VALID_ACTIONS)[number]

const ACTION_TO_STATUS: Record<Action, string> = {
  start: 'prepare',
  stop: 'inactive',
  restart: 'restart',
}

const ALLOWED_MODEL_FIELDS = new Set([
  'name',
  'device',
  'backend',
  'source',
  'type',
  'quant',
  'params',
])

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const numericId = Number(id)
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: 'Invalid service ID' }, { status: 400 })
  }

  let body: { action?: string; config?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const payload = await getPayload({ config })

  // Verify the service exists
  const service = await payload.findByID({
    collection: 'services',
    id: numericId,
  })

  if (!service) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 })
  }

  if (body.config) {
    const modelUpdate: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(body.config)) {
      if (ALLOWED_MODEL_FIELDS.has(key) && typeof value === 'string') {
        modelUpdate[key] = value
      }
    }

    const metadataUpdate =
      body.config.metadata &&
      typeof body.config.metadata === 'object' &&
      !Array.isArray(body.config.metadata)
        ? (body.config.metadata as Record<string, unknown>)
        : undefined

    const hasModelFields = Object.keys(modelUpdate).length > 0

    if (!hasModelFields && !metadataUpdate) {
      return NextResponse.json(
        {
          error:
            "Config update requires at least one of 'name'+'device' or 'metadata'.",
        },
        { status: 400 },
      )
    }

    if (hasModelFields && (!modelUpdate.name || !modelUpdate.device)) {
      return NextResponse.json(
        { error: "Model config update requires both 'name' and 'device'." },
        { status: 400 },
      )
    }

    // If backend changed, update the healthCheck expression to match
    const newBackend =
      typeof modelUpdate.backend === 'string' ? modelUpdate.backend : undefined
    const currentBackend = (service.models?.default as Record<string, unknown>)
      ?.backend as string | undefined
    const healthCheckUpdate =
      newBackend && newBackend !== currentBackend
        ? getBackendByValue(newBackend)?.healthcheck
        : undefined

    const updated = await payload.update({
      collection: 'services',
      id: numericId,
      data: {
        ...(hasModelFields && {
          models: {
            ...service.models,
            default: modelUpdate,
          },
        }),
        ...(healthCheckUpdate ? { healthCheck: healthCheckUpdate } : {}),
        ...(metadataUpdate
          ? {
              metadata: Object.fromEntries(
                Object.entries({
                  ...(service.metadata as Record<string, unknown> | undefined),
                  ...metadataUpdate,
                }).filter(([, v]) => v !== null && v !== undefined),
              ),
            }
          : {}),
        status: service.status !== 'inactive' ? 'restart' : service.status,
      },
    })

    return NextResponse.json(updated)
  }

  const action = body.action as Action
  if (!VALID_ACTIONS.includes(action)) {
    return NextResponse.json(
      {
        error: `Invalid request. Provide either 'action' (${VALID_ACTIONS.join(', ')}) or 'config'.`,
      },
      { status: 400 },
    )
  }

  const newStatus = ACTION_TO_STATUS[action]

  const updated = await payload.update({
    collection: 'services',
    id: numericId,
    data: {
      status: newStatus as
        'prepare' | 'active' | 'inactive' | 'restart' | 'error',
    },
  })

  return NextResponse.json(updated)
}

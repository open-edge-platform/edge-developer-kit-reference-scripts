// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** `services` collection hooks: field rules on every write, and starts/stops on status changes. */

import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  CollectionBeforeValidateHook,
} from 'payload'
import {
  duplicateInstanceLabelMessage,
  findInstanceWithLabel,
  getInstanceLabel,
  isValidInstanceId,
  uniqueInstanceId,
} from '@/lib/instances/instances'
import { logger } from '@/lib/logger'
import { removeServiceRowFromSampleBindings } from '@/lib/settings/sample-settings-store'
import {
  invalidateInstancePortCache,
  releaseInstancePort,
} from '@/lib/workers/instance-ports'
import { removeInstanceDataDir } from '@/lib/workers/instance-runtime'
import { canonicalizeModel } from '@/lib/workers/instance-seed'
import {
  awaitPendingStop,
  cleanUpErroredInstance,
  startInstance,
  stopInactiveInstance,
  stopInstance,
} from '@/lib/workers/worker-lifecycle'
import type { Service } from '@/payload-types'
import { metaMap } from '@/services/_generated/meta'

/** Rows of one type a hook reads; far above any instance cap. */
const MAX_ROWS_PER_TYPE = 100

/**
 * Normalises instance fields and enforces unique (type, instanceId) and (type, name), backing up the
 * API routes' 409 checks. A new row derives its id from its name; an existing row keeps it through
 * renames. llama.cpp models are stored in canonical form (`canonicalizeModel`).
 */
export const validateInstanceFields: CollectionBeforeValidateHook<
  Service
> = async ({ data, originalDoc, operation, req }) => {
  if (!data) return data

  // The health check matches the stored name against the engine's `repo:QUANT`, so a separate quant
  // field would keep the instance from ever turning healthy.
  if (data.models?.default) {
    data.models = {
      ...data.models,
      default: canonicalizeModel(data.models.default),
    }
  }

  const type = data.type ?? originalDoc?.type
  const siblingsOf = async () =>
    type
      ? (
          await req.payload.find({
            collection: 'services',
            where: {
              and: [
                { type: { equals: type } },
                ...(originalDoc?.id
                  ? [{ id: { not_equals: originalDoc.id } }]
                  : []),
              ],
            },
            limit: MAX_ROWS_PER_TYPE,
          })
        ).docs
      : []

  // An update keeps the row's id unless it names another one explicitly
  // (only the startup move off the legacy `default` id does).
  let originalInstanceId: string | undefined
  if (originalDoc != null) originalInstanceId = originalDoc.instanceId
  const rawId = data.instanceId ?? originalInstanceId ?? ''
  let instanceId = String(rawId ?? '')
    .trim()
    .toLowerCase()
  if (!instanceId) {
    const name =
      (data.label ?? originalDoc?.label)?.trim() ||
      (type ? metaMap[type]?.name : undefined) ||
      'instance'
    instanceId = uniqueInstanceId(
      name,
      (await siblingsOf()).map((s) => s.instanceId),
    )
  }

  if (!isValidInstanceId(instanceId)) {
    throw new Error(
      `Invalid instance id "${rawId}": use 1–32 lowercase letters, digits or dashes, starting and ending with a letter or digit`,
    )
  }

  data.instanceId = instanceId

  if (
    type &&
    (operation === 'create' || data.instanceId !== originalDoc?.instanceId)
  ) {
    const clash = await req.payload.find({
      collection: 'services',
      where: {
        and: [
          { type: { equals: type } },
          { instanceId: { equals: instanceId } },
          ...(originalDoc?.id ? [{ id: { not_equals: originalDoc.id } }] : []),
        ],
      },
      limit: 1,
    })
    if (clash.totalDocs > 0) {
      throw new Error(`An instance "${instanceId}" of ${type} already exists`)
    }
  }

  // Only a new row or an actual name change is checked, so rows saved before
  // names were unique can still be updated without being renamed first.
  if (typeof data.label === 'string') {
    data.label = data.label.trim()
  }
  const nameChanged =
    typeof data.label === 'string' &&
    (!originalDoc ||
      data.label.toLowerCase() !== getInstanceLabel(originalDoc).toLowerCase())
  if (type && (operation === 'create' || nameChanged)) {
    const label = getInstanceLabel({ ...originalDoc, ...data })
    if (findInstanceWithLabel(label, await siblingsOf())) {
      throw new Error(duplicateInstanceLabelMessage(label))
    }
  }

  return data
}

export const deleteServiceAfterDelete: CollectionAfterDeleteHook<
  Service
> = async ({ doc, req }) => {
  const label = `${doc.type}@${doc.instanceId}`
  invalidateInstancePortCache()

  try {
    await stopInstance(doc)
  } catch (error) {
    logger.error(`Error stopping process for service ${label}:`, error)
  }
  try {
    removeInstanceDataDir(doc)
  } catch (error) {
    logger.error(`Error removing data dir for ${label}:`, error)
  }
  // A sample bound to this instance goes back to automatic; forgetting the
  // row id now keeps a later row with the same id from inheriting it.
  try {
    await removeServiceRowFromSampleBindings(req.payload, doc.id)
  } catch (error) {
    logger.error(`Error unbinding samples from ${label}:`, error)
  }
  return doc
}

export const afterServiceChange: CollectionAfterChangeHook<Service> = async ({
  doc,
  previousDoc,
  operation,
  req: { payload },
}) => {
  invalidateInstancePortCache()

  if (operation !== 'update') {
    if (doc.status !== 'inactive') {
      await startInstance(doc, payload)
    }
    return
  }

  // Switching engines hands the port and process slot over: stop what runs under the old one (e.g.
  // an engine started from Runtime Settings while inactive, which no status change would stop) and
  // release the port so the next start allocates a block sized for the new engine.
  if (previousDoc.engine !== doc.engine) {
    await stopInstance(doc)
    await releaseInstancePort(payload, doc)
  }

  if (previousDoc.status === doc.status) return

  switch (doc.status) {
    case 'inactive':
      await awaitPendingStop(doc)
      await stopInactiveInstance(doc, payload)
      return
    case 'restart':
      await awaitPendingStop(doc)
      await stopInstance(doc)
      await payload.update({
        collection: 'services',
        id: doc.id,
        data: { status: 'prepare' },
      })
      return
    case 'prepare':
      await awaitPendingStop(doc)
      await startInstance(doc, payload)
      return
    case 'error':
      // Only reached once the process is gone or unhealthy: clean up what is
      // left and hand the port back so a retry (or a sibling) can use it.
      await cleanUpErroredInstance(doc, payload)
      return
    default:
      return
  }
}

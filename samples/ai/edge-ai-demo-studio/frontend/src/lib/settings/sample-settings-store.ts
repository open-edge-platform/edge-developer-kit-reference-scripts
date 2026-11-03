// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { BasePayload } from 'payload'
import {
  normalizeSampleInstanceBindings,
  type SampleInstanceBindings,
  withoutServiceRow,
} from './sample-settings'

/**
 * Takes the Payload instance rather than importing `@payload-config`, so the services collection's
 * hooks (which the config imports) can call it too.
 */
export async function readSampleInstanceBindings(
  payload: BasePayload,
): Promise<SampleInstanceBindings> {
  const settings = await payload.findGlobal({ slug: 'sample-settings' })
  return normalizeSampleInstanceBindings(settings.instances)
}

export async function writeSampleInstanceBindings(
  payload: BasePayload,
  instances: SampleInstanceBindings,
): Promise<void> {
  await payload.updateGlobal({ slug: 'sample-settings', data: { instances } })
}

/** Forgets every binding to row `rowId`, so a reused row id cannot inherit a stale binding. */
export async function removeServiceRowFromSampleBindings(
  payload: BasePayload,
  rowId: number,
): Promise<void> {
  const current = await readSampleInstanceBindings(payload)
  const next = withoutServiceRow(current, rowId)
  if (next !== current) await writeSampleInstanceBindings(payload, next)
}

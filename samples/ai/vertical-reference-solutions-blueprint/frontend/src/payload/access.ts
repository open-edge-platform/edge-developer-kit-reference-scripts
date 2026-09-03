// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Access, CollectionConfig, Field } from 'payload'

/**
 * Shared secret external REST callers (tests, scripts) send on calls to
 * /cms-api. The kiosk's own routes use the Local API and never need it —
 * this only keeps the registry's REST surface off anonymous hands.
 */
export const KIOSK_CMS_KEY =
  process.env.KIOSK_CMS_KEY ??
  (() => {
    throw new Error('KIOSK_CMS_KEY is not set — configure cms.kiosk_key in config.yaml')
  })()

/** Allow logged-in admin users and requests bearing the kiosk key. */
export const kioskOrAdmin: Access = ({ req }) =>
  Boolean(req.user) || req.headers.get('x-kiosk-key') === KIOSK_CMS_KEY

/** Admin users only — the kiosk key never gets this far. */
const adminOnly: Access = ({ req }) => Boolean(req.user)

/**
 * The kiosk reads and writes; only an admin may delete. Pass `del: 'kiosk'`
 * for collections the kiosk itself cleans up (saved drafts), or
 * `update: 'admin'` for records that must not change after creation.
 */
export function kioskAccess(
  overrides: { update?: 'admin'; del?: 'kiosk' } = {},
): CollectionConfig['access'] {
  return {
    read: kioskOrAdmin,
    create: kioskOrAdmin,
    update: overrides.update === 'admin' ? adminOnly : kioskOrAdmin,
    delete: overrides.del === 'kiosk' ? kioskOrAdmin : adminOnly,
  }
}

/**
 * Links a registry record to its owning citizen. `documentNumber` is
 * denormalised so lookups by IC / passport skip the join — and is deliberately
 * not named `citizenId`, which would collide with the `citizen` relationship's
 * own `citizen_id` column in SQLite.
 */
export function citizenOwnerFields(description = 'Denormalised IC / passport number for direct lookup.'): Field[] {
  return [
    { name: 'citizen', type: 'relationship', relationTo: 'citizens', required: true, index: true },
    {
      name: 'documentNumber',
      type: 'text',
      required: true,
      index: true,
      admin: { description },
    },
  ]
}

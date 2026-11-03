// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Access, CollectionConfig } from 'payload'

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

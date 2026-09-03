// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CollectionConfig } from 'payload'
import { citizenOwnerFields, kioskAccess } from '../access'

/**
 * Vehicle ownership registry (JPJ). Seeded so every citizen owns one or more
 * vehicles; the road tax renewal service looks these up by the verified
 * citizen's IC / passport number and lets them pick which vehicle to renew.
 */
export const Vehicles: CollectionConfig = {
  slug: 'vehicles',
  admin: {
    useAsTitle: 'plateNumber',
    defaultColumns: ['plateNumber', 'model', 'year', 'roadTaxExpiry'],
    group: 'Registry',
  },
  access: kioskAccess(),
  fields: [
    { name: 'plateNumber', type: 'text', required: true, unique: true, index: true },
    ...citizenOwnerFields('Denormalised IC / passport number for direct ownership lookup.'),
    { name: 'model', type: 'text', required: true },
    { name: 'year', type: 'number', required: true },
    { name: 'engineCc', type: 'number', required: true },
    { name: 'roadTaxExpiry', type: 'date', required: true },
  ],
}

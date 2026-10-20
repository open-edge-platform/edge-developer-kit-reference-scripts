// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CollectionConfig } from 'payload'
import { citizenOwnerFields, kioskAccess } from '../access'

/**
 * Driving license registry (JPJ). Seeded so citizens hold zero or more
 * license classes — never D and DA together, since class D covers automatic
 * cars. The renewal service lists only the classes a citizen holds; the new
 * application service offers only the ones they don't.
 */
export const Licenses: CollectionConfig = {
  slug: 'licenses',
  admin: {
    useAsTitle: 'licenseNo',
    defaultColumns: ['licenseNo', 'licenseClass', 'licenseType', 'expiresAt'],
    group: 'Registry',
  },
  access: kioskAccess(),
  fields: [
    { name: 'licenseNo', type: 'text', required: true, unique: true, index: true },
    ...citizenOwnerFields(),
    {
      name: 'licenseClass',
      type: 'select',
      required: true,
      options: ['B2', 'D', 'DA'],
      admin: { description: 'B2 motorcycle, D manual car (covers DA), DA automatic car.' },
    },
    {
      name: 'licenseType',
      type: 'select',
      required: true,
      defaultValue: 'CDL',
      options: ['PDL', 'CDL'],
      admin: { description: 'PDL = 2-year probationary; CDL = competent license.' },
    },
    { name: 'issuedAt', type: 'date', required: true },
    {
      name: 'expiresAt',
      type: 'date',
      required: true,
      admin: {
        description:
          'Expired > 3 years means the license is cancelled under the Road Transport Act.',
      },
    },
  ],
}

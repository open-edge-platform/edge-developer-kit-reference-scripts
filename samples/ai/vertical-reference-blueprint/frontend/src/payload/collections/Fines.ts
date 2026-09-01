// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CollectionConfig } from 'payload'
import { citizenOwnerFields, kioskAccess } from '../access'

/**
 * Individual traffic summonses (saman). Generated at seed time from each
 * citizen's UnpaidFineCount / TotalUnpaidAmount so the Traffic Fine Payment
 * service can look them up by summons number, plate or IC and settle them.
 */
export const Fines: CollectionConfig = {
  slug: 'fines',
  admin: {
    useAsTitle: 'summonsNo',
    defaultColumns: ['summonsNo', 'plateNumber', 'offence', 'amount', 'status'],
    group: 'Registry',
  },
  access: kioskAccess(),
  fields: [
    { name: 'summonsNo', type: 'text', required: true, unique: true, index: true },
    ...citizenOwnerFields(),
    { name: 'plateNumber', type: 'text', required: true, index: true },
    { name: 'offence', type: 'text', required: true },
    { name: 'amount', type: 'number', required: true },
    { name: 'issuedAt', type: 'date', required: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'unpaid',
      options: ['unpaid', 'paid'],
    },
    {
      name: 'paymentId',
      type: 'text',
      admin: { description: 'Kiosk payment reference that settled this summons.' },
    },
  ],
}

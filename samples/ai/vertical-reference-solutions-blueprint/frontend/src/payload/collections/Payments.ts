// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CollectionConfig } from 'payload'
import { kioskAccess } from '../access'

/** Payments captured at the kiosk terminal. */
export const Payments: CollectionConfig = {
  slug: 'payments',
  admin: {
    useAsTitle: 'paymentId',
    defaultColumns: ['paymentId', 'serviceId', 'method', 'amount', 'paidAt'],
    group: 'Kiosk',
  },
  access: kioskAccess({ update: 'admin' }),
  fields: [
    { name: 'paymentId', type: 'text', required: true, unique: true, index: true },
    { name: 'serviceId', type: 'text', required: true, index: true },
    { name: 'citizen', type: 'relationship', relationTo: 'citizens', index: true },
    {
      name: 'method',
      type: 'select',
      required: true,
      options: ['card', 'qr', 'cash'],
    },
    { name: 'amount', type: 'number', required: true },
    { name: 'currency', type: 'text', required: true },
    {
      name: 'breakdown',
      type: 'group',
      fields: [
        { name: 'serviceFee', type: 'number' },
        { name: 'processingFee', type: 'number' },
      ],
    },
    { name: 'paidAt', type: 'date', required: true },
  ],
}

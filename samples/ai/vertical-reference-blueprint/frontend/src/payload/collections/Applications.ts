// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CollectionConfig } from 'payload'
import { kioskAccess } from '../access'

/** Service applications submitted at the kiosk, one per completed flow. */
export const Applications: CollectionConfig = {
  slug: 'applications',
  admin: {
    useAsTitle: 'caseId',
    defaultColumns: ['caseId', 'serviceLabel', 'status', 'submittedAt'],
    group: 'Kiosk',
  },
  access: kioskAccess(),
  fields: [
    { name: 'caseId', type: 'text', required: true, unique: true, index: true },
    { name: 'serviceId', type: 'text', required: true, index: true },
    { name: 'serviceLabel', type: 'text', required: true },
    { name: 'citizen', type: 'relationship', relationTo: 'citizens', index: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'in_review',
      options: [
        { label: 'In Review', value: 'in_review' },
        { label: 'Officer Review', value: 'officer_review' },
        { label: 'On Hold', value: 'on_hold' },
        { label: 'Approved', value: 'approved' },
      ],
    },
    {
      name: 'statusReason',
      type: 'text',
      admin: { description: 'Why the application needs officer review or is on hold.' },
    },
    {
      name: 'data',
      type: 'json',
      admin: { description: 'Answers collected by the service-specific steps.' },
    },
    { name: 'paymentId', type: 'text' },
    { name: 'submittedAt', type: 'date', required: true },
  ],
}

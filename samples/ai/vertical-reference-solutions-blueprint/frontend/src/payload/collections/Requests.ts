// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CollectionConfig } from 'payload'
import { kioskAccess } from '../access'

/**
 * In-progress applications saved ("paused") at the kiosk before submission.
 * One draft per citizen + service — saving again overwrites the earlier draft,
 * and submitting the application deletes it. Completed submissions live in
 * the `applications` collection instead.
 */
export const Requests: CollectionConfig = {
  slug: 'requests',
  admin: {
    useAsTitle: 'requestId',
    defaultColumns: ['requestId', 'serviceLabel', 'documentNumber', 'stepId', 'savedAt'],
    group: 'Kiosk',
  },
  access: kioskAccess({ del: 'kiosk' }),
  fields: [
    { name: 'requestId', type: 'text', required: true, unique: true, index: true },
    { name: 'serviceId', type: 'text', required: true, index: true },
    { name: 'serviceLabel', type: 'text', required: true },
    { name: 'documentNumber', type: 'text', required: true, index: true },
    { name: 'citizen', type: 'relationship', relationTo: 'citizens', index: true },
    {
      name: 'stepId',
      type: 'text',
      required: true,
      admin: { description: 'Step the visitor paused on, e.g. documents or payment.' },
    },
    { name: 'stepIndex', type: 'number', required: true },
    {
      name: 'data',
      type: 'json',
      admin: { description: 'Answers collected so far, restored on resume.' },
    },
    {
      name: 'documents',
      type: 'json',
      admin: { description: 'Uploaded-document receipts, restored on resume.' },
    },
    { name: 'savedAt', type: 'date', required: true },
  ],
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CollectionConfig } from 'payload'
import { COUNTRIES } from '@/lib/countries'
import { kioskOrAdmin } from '../access'

/** Synthetic citizen registry — DEMO DATA ONLY. Seeded from data/citizens.csv on first init. */
export const Citizens: CollectionConfig = {
  slug: 'citizens',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['citizenId', 'name', 'nfcUid', 'faceImage', 'country', 'hasOutstandingFines'],
    group: 'Registry',
  },
  access: {
    read: kioskOrAdmin,
    create: kioskOrAdmin,
    update: kioskOrAdmin,
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    {
      name: 'citizenKey',
      type: 'number',
      required: true,
      unique: true,
      admin: { description: 'Row number in the source CSV; drives deterministic demo data.' },
    },
    {
      name: 'citizenId',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      label: 'Citizen ID (IC / Passport No.)',
      admin: {
        description:
          'Identity the kiosk keys everything on — read off this record once the citizen ' +
          'has been identified, not off the card itself.',
      },
    },
    {
      name: 'nfcUid',
      type: 'text',
      unique: true,
      index: true,
      label: 'NFC card serial (UID)',
      admin: {
        description:
          'Serial of the contactless card that opens this record at the kiosk, as bare hex ' +
          '(e.g. 04A2B3C4D5E6). Tap the card on the reader and run `npm run nfc:probe` to ' +
          'read one off a card. Empty means no card is bound to this citizen, so the kiosk ' +
          'ID reader cannot identify them — the face check and every service still work once ' +
          'they are identified another way.',
      },
    },
    { name: 'name', type: 'text', required: true },
    {
      name: 'faceImage',
      type: 'upload',
      relationTo: 'face-photos',
      label: 'Face reference photo',
      admin: {
        description:
          'Optional portrait the kiosk camera is matched against. Drop an image here to ' +
          'upload one, or pick an existing photo. A citizen with no photo cannot pass the ' +
          'face check — there is nothing to match them to. Changing it takes effect on the ' +
          'next check; the old portrait is dropped from the matcher automatically.',
      },
    },
    {
      name: 'country',
      type: 'select',
      required: true,
      options: [...COUNTRIES],
      admin: {
        description: 'Malaysians present a MyKad at the kiosk; foreigners a passport.',
      },
    },
    { name: 'age', type: 'number' },
    { name: 'phone', type: 'text' },
    { name: 'email', type: 'text' },
    {
      type: 'row',
      fields: [
        {
          name: 'race',
          type: 'select',
          options: ['Malay', 'Chinese', 'Indian', 'Other'],
        },
        {
          name: 'religion',
          type: 'select',
          options: ['Islam', 'Buddhist', 'Christian', 'Hindu', 'Other'],
          admin: {
            description:
              'Muslims marry via the Syariah system — Act 164 civil marriage is non-Muslim only.',
          },
        },
      ],
    },
    {
      name: 'maritalStatus',
      type: 'select',
      options: ['single', 'married'],
      admin: { description: 'NRD civil status — an existing marriage blocks a new KC02 notice.' },
    },
    {
      name: 'monthlyIncome',
      type: 'number',
      admin: { description: 'Declared household income (RM) used for JKM means-testing.' },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'isOku',
          type: 'checkbox',
          defaultValue: false,
          label: 'Registered OKU',
          admin: { description: 'JKM disability registration — gates BTB / EPOKU schemes.' },
        },
        {
          name: 'childrenUnder18',
          type: 'number',
          defaultValue: 0,
          admin: { description: 'Dependent children on record — gates the BKK child-aid scheme.' },
        },
      ],
    },
    {
      name: 'idCardLossCount',
      type: 'number',
      defaultValue: 0,
      admin: { description: 'Previous lost-MyKad reports at JPN; sets the replacement fee tier.' },
    },
    {
      name: 'address',
      type: 'group',
      fields: [
        { name: 'line', type: 'text', required: true },
        { name: 'city', type: 'text', required: true },
        { name: 'postcode', type: 'text', required: true },
      ],
    },
    { name: 'notes', type: 'text' },
    {
      type: 'row',
      fields: [
        { name: 'hasCriminalRecord', type: 'checkbox', defaultValue: false },
        { name: 'hasOutstandingFines', type: 'checkbox', defaultValue: false },
      ],
    },
    {
      name: 'criminalRecord',
      type: 'group',
      admin: { condition: (data) => Boolean(data?.hasCriminalRecord) },
      fields: [
        { name: 'type', type: 'text' },
        { name: 'status', type: 'select', options: ['Closed', 'Under Review', 'Pending Court'] },
        { name: 'severity', type: 'select', options: ['Low', 'Medium', 'High'] },
        {
          name: 'officerReviewRequired',
          type: 'checkbox',
          defaultValue: false,
          admin: { description: 'Blocks self-service clearance certificates when checked.' },
        },
      ],
    },
    {
      name: 'unpaidFineCount',
      type: 'number',
      defaultValue: 0,
      admin: { description: 'Denormalised from the fines collection; updated when fines are paid.' },
    },
    { name: 'totalUnpaidAmount', type: 'number', defaultValue: 0 },
  ],
}

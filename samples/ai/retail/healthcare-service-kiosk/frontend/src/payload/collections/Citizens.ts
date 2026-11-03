// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CollectionConfig } from 'payload'
import { countries } from '@/lib/countries'
import { kioskOrAdmin } from '../access'

/** The patient registry — DEMO DATA ONLY. Seeded from data/citizens.csv on first init.
 *  The slug and the civic columns (hidden below) are kept from the shared kit: dropping a
 *  populated column makes Payload's dev schema push stop for confirmation. */
const legacy = { hidden: true } as const

export const Citizens: CollectionConfig = {
  slug: 'citizens',
  labels: { singular: 'Patient', plural: 'Patients' },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['citizenId', 'name', 'dateOfBirth', 'nfcUid', 'faceImage', 'country'],
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
      admin: {
        description:
          'Registry key: the CSV row for seeded patients, the next free number for ones registered at the desk.',
      },
    },
    {
      name: 'citizenId',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      label: 'IC / Passport No.',
      admin: {
        description:
          'Identity the kiosk keys everything on — the MRN and the hospital record derive from it.',
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
          'read one off a card. Empty means no card is bound to this patient, so the kiosk ' +
          'ID reader cannot identify them — a patient card, an appointment slip or a typed MRN ' +
          'with their date of birth still does.',
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
          'upload one, or pick an existing photo. A patient with no photo cannot pass the ' +
          'face check — there is nothing to match them to. Changing it takes effect on the ' +
          'next check; the old portrait is dropped from the matcher automatically.',
      },
    },
    {
      name: 'country',
      type: 'select',
      required: true,
      options: [...countries()],
      admin: {
        description: 'Malaysians present a MyKad at the kiosk; foreigners a passport.',
      },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'dateOfBirth',
          type: 'date',
          label: 'Date of birth',
          admin: {
            date: { pickerAppearance: 'dayOnly', displayFormat: 'd MMM yyyy' },
            description:
              'What a patient confirms after scanning their patient card or slip. Blank on a seeded ' +
              'patient means the demo date derived from their registry key and age.',
          },
        },
        { name: 'sex', type: 'select', options: ['female', 'male'] },
      ],
    },
    { name: 'age', type: 'number', admin: { description: 'Kept in step with the date of birth when one is set.' } },
    { name: 'phone', type: 'text' },
    { name: 'email', type: 'text' },
    { name: 'allergies', type: 'text', admin: { description: 'As the patient reported them, e.g. "Penicillin; peanuts". Blank means none known.' } },
    {
      name: 'emergencyContact',
      type: 'group',
      label: 'Emergency contact',
      fields: [
        {
          type: 'row',
          fields: [
            { name: 'name', type: 'text' },
            { name: 'relationship', type: 'text' },
            { name: 'phone', type: 'text' },
          ],
        },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'race', type: 'select', options: ['Malay', 'Chinese', 'Indian', 'Other'], admin: legacy },
        {
          name: 'religion',
          type: 'select',
          options: ['Islam', 'Buddhist', 'Christian', 'Hindu', 'Other'],
          admin: legacy,
        },
      ],
    },
    { name: 'maritalStatus', type: 'select', options: ['single', 'married'], admin: legacy },
    { name: 'monthlyIncome', type: 'number', admin: legacy },
    {
      type: 'row',
      fields: [
        { name: 'isOku', type: 'checkbox', defaultValue: false, admin: legacy },
        { name: 'childrenUnder18', type: 'number', defaultValue: 0, admin: legacy },
      ],
    },
    { name: 'idCardLossCount', type: 'number', defaultValue: 0, admin: legacy },
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
        { name: 'hasCriminalRecord', type: 'checkbox', defaultValue: false, admin: legacy },
        { name: 'hasOutstandingFines', type: 'checkbox', defaultValue: false, admin: legacy },
      ],
    },
    {
      name: 'criminalRecord',
      type: 'group',
      admin: legacy,
      fields: [
        { name: 'type', type: 'text' },
        { name: 'status', type: 'select', options: ['Closed', 'Under Review', 'Pending Court'] },
        { name: 'severity', type: 'select', options: ['Low', 'Medium', 'High'] },
        { name: 'officerReviewRequired', type: 'checkbox', defaultValue: false },
      ],
    },
    { name: 'unpaidFineCount', type: 'number', defaultValue: 0, admin: legacy },
    { name: 'totalUnpaidAmount', type: 'number', defaultValue: 0, admin: legacy },
  ],
}

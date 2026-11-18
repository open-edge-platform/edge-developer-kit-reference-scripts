// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CollectionConfig } from 'payload';

import { publicAccess } from '../access';

export const Materials: CollectionConfig = {
  slug: 'materials',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'color', 'updatedAt'],
  },
  access: {
    create: publicAccess,
    read: publicAccess,
    update: publicAccess,
    delete: publicAccess,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'color',
      type: 'text',
      required: true,
      defaultValue: '#9eb4c8',
    },
    {
      name: 'metallic',
      type: 'number',
      required: true,
      min: 0,
      max: 1,
      defaultValue: 0,
    },
    {
      name: 'roughness',
      type: 'number',
      required: true,
      min: 0,
      max: 1,
      defaultValue: 0.6,
    },
    {
      name: 'texture',
      type: 'relationship',
      relationTo: 'assets',
      admin: {
        description: 'Optional PNG or JPG image used by this material.',
      },
    },
    {
      name: 'visibility',
      type: 'select',
      required: true,
      defaultValue: 'library',
      options: [
        { label: 'Private', value: 'private' },
        { label: 'Library', value: 'library' },
      ],
    },
  ],
};

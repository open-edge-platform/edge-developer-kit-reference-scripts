// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CollectionConfig } from 'payload';

import { publicAccess } from '../access';

export const Robots: CollectionConfig = {
  slug: 'robots',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'manufacturer', 'updatedAt'],
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
      name: 'slug',
      type: 'text',
      unique: true,
      index: true,
    },
    {
      name: 'description',
      type: 'textarea',
    },
    {
      name: 'manufacturer',
      type: 'text',
    },
    {
      name: 'thumbnail',
      type: 'upload',
      relationTo: 'assets',
    },
    {
      name: 'mjcf',
      type: 'code',
      required: true,
      admin: {
        language: 'xml',
      },
    },
    {
      name: 'meshes',
      type: 'relationship',
      relationTo: 'assets',
      hasMany: true,
    },
    {
      name: 'tags',
      type: 'text',
      hasMany: true,
    },
  ],
};

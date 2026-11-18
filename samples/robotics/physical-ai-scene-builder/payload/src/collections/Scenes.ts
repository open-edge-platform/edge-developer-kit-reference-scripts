// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CollectionConfig } from 'payload';

import { publicAccess } from '../access';
import { deleteSceneRuntimeData } from '../sceneRuntimeCleanup';
import { deleteUnusedPrivateAssets, sceneAssetIds } from './privateAssetCleanup';

export const Scenes: CollectionConfig = {
  slug: 'scenes',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'project', 'updatedAt'],
  },
  access: {
    create: publicAccess,
    read: publicAccess,
    update: publicAccess,
    delete: publicAccess,
  },
  hooks: {
    afterDelete: [
      async ({ doc, req }) => {
        await deleteSceneRuntimeData(String(doc.id));
        await deleteUnusedPrivateAssets(sceneAssetIds(doc), req);
      },
    ],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'project',
      type: 'relationship',
      relationTo: 'projects',
      index: true,
    },
    {
      name: 'isTemplate',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      admin: {
        description: 'Reusable scene snapshot shown in the project template list.',
      },
    },
    {
      name: 'graph',
      type: 'json',
      admin: {
        description: 'Serialized editor scene graph.',
      },
    },
    {
      name: 'mjcf',
      type: 'code',
      admin: {
        language: 'xml',
        description: 'MJCF source compiled by the MuJoCo runtime.',
      },
    },
    {
      name: 'assets',
      type: 'relationship',
      relationTo: 'assets',
      hasMany: true,
      admin: {
        description: 'Mesh and texture assets referenced by the MJCF source.',
      },
    },
    {
      name: 'thumbnail',
      type: 'upload',
      relationTo: 'assets',
    },
  ],
};

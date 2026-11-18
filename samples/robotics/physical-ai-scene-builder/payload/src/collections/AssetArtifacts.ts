// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CollectionConfig } from 'payload';

import { publicAccess } from '../access';
import { dataPath } from '../storage';

export const AssetArtifacts: CollectionConfig = {
  slug: 'asset-artifacts',
  upload: {
    staticDir: dataPath('artifacts'),
    mimeTypes: ['image/webp', 'model/stl', 'application/octet-stream', 'text/plain'],
  },
  admin: {
    hidden: true,
  },
  access: {
    create: publicAccess,
    read: publicAccess,
    update: publicAccess,
    delete: publicAccess,
  },
  fields: [
    {
      name: 'visibility',
      type: 'select',
      required: true,
      defaultValue: 'private',
      options: [
        { label: 'Private', value: 'private' },
        { label: 'Library', value: 'library' },
      ],
    },
    {
      name: 'artifactType',
      type: 'select',
      required: true,
      options: [
        { label: 'Canonical mesh', value: 'canonicalMesh' },
        { label: 'Collision mesh', value: 'collisionMesh' },
        { label: 'Thumbnail', value: 'thumbnail' },
      ],
    },
  ],
};

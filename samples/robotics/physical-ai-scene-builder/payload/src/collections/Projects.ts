// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CollectionConfig } from 'payload';

import { publicAccess } from '../access';
import { deleteUnusedPrivateAssets, idOf } from './privateAssetCleanup';

export const Projects: CollectionConfig = {
  slug: 'projects',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'updatedAt'],
  },
  access: {
    create: publicAccess,
    read: publicAccess,
    update: publicAccess,
    delete: publicAccess,
  },
  hooks: {
    beforeDelete: [
      async ({ id, req }) => {
        // Delete through Payload so scene and asset upload hooks run for direct API deletes too.
        for (;;) {
          const scenes = await req.payload.find({
            collection: 'scenes',
            where: { project: { equals: id } },
            depth: 0,
            limit: 100,
            req,
          });
          if (!scenes.docs.length) break;
          for (const scene of scenes.docs) {
            await req.payload.delete({ collection: 'scenes', id: scene.id, req });
          }
        }

        let page = 1;
        for (;;) {
          const assets = await req.payload.find({
            collection: 'assets',
            where: { and: [{ project: { equals: id } }, { visibility: { equals: 'private' } }] },
            depth: 0,
            limit: 100,
            page,
            sort: 'id',
            req,
          });
          if (!assets.docs.length) break;
          const ids = assets.docs
            .map((asset) => idOf(asset.id))
            .filter((id): id is number => id !== null);
          await deleteUnusedPrivateAssets(ids, req);
          // Revisit the first page after deletions; advance if every asset is still referenced.
          const remaining = await req.payload.find({
            collection: 'assets',
            where: { id: { in: ids } },
            depth: 0,
            limit: 1,
            req,
          });
          if (remaining.totalDocs === ids.length) page++;
          if (page > assets.totalPages) break;
        }
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
      name: 'slug',
      type: 'text',
      unique: true,
      index: true,
      admin: {
        description: 'URL identifier. Generated from the name when left empty.',
      },
      hooks: {
        beforeValidate: [
          async ({ value, data, originalDoc, req }) => {
            const baseSlug = String(value ?? data?.name ?? '')
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/(^-|-$)/g, '');
            if (!baseSlug) return baseSlug;

            let candidate = baseSlug;
            let suffix = 2;
            while (true) {
              const result = await req.payload.find({
                collection: 'projects',
                depth: 0,
                limit: 1,
                where: { slug: { equals: candidate } },
              });
              const existing = result.docs[0];
              if (!existing || existing.id === originalDoc?.id) return candidate;
              candidate = `${baseSlug}-${suffix}`;
              suffix++;
            }
          },
        ],
      },
    },
    {
      name: 'description',
      type: 'textarea',
    },
  ],
};

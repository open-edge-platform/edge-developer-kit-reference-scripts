// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import config from '@payload-config';
import { getPayload } from 'payload';
import sharp from 'sharp';

import type { Obj2MjcfResult } from '@/lib/process/obj2mjcf';
import type { AssetCategory } from '@/lib/scenes/assetsApi';

/**
 * Saves a converted object (files already under `data/imageto3D/<bundleId>`) to the asset library
 * so it can be placed again without converting it again. `preview` is any image sharp can read
 * (the source photo, or an SVG render of the mesh) and becomes the thumbnail.
 */
export async function saveObjectModelAsset({
  bundleId,
  name,
  category = 'general',
  conversion,
  preview,
  tags,
}: {
  bundleId: string;
  name: string;
  category?: AssetCategory;
  conversion: Obj2MjcfResult;
  preview: Uint8Array | null;
  tags: string[];
}): Promise<number> {
  const payload = await getPayload({ config });
  let thumbnail: { id: number } | null = null;
  if (preview) {
    const thumbnailBytes = await sharp(preview)
      .resize(320, 320, { fit: 'cover' })
      .webp({ quality: 82 })
      .toBuffer();
    const artifact = await payload.create({
      collection: 'asset-artifacts',
      data: { artifactType: 'thumbnail', visibility: 'library' },
      file: {
        data: thumbnailBytes,
        mimetype: 'image/webp',
        name: `${bundleId}-thumbnail.webp`,
        size: thumbnailBytes.byteLength,
      },
    });
    if (typeof artifact.id === 'number') thumbnail = { id: artifact.id };
  }
  try {
    const asset = await payload.create({
      collection: 'assets',
      data: {
        name,
        kind: 'mesh',
        category,
        tags,
        processingStatus: 'ready',
        processingProgress: 100,
        thumbnail: thumbnail?.id ?? null,
        objectModel: { bundleId, mjcf: conversion.mjcf, files: conversion.files },
      },
    });
    if (typeof asset.id !== 'number') throw new Error('The saved object has no numeric ID.');
    return asset.id;
  } catch (error) {
    if (thumbnail) {
      await payload.delete({ collection: 'asset-artifacts', id: thumbnail.id }).catch(() => {});
    }
    throw error;
  }
}

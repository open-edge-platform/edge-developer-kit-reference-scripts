// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { PayloadRequest } from 'payload';

export function idOf(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'number') {
    return value.id;
  }
  return null;
}

/** Keep project-private uploads while another scene (including a template) still uses them. */
export async function deleteUnusedPrivateAssets(
  assetIds: Iterable<number>,
  req: PayloadRequest,
): Promise<void> {
  for (const id of new Set(assetIds)) {
    const asset = await req.payload.findByID({ collection: 'assets', id, depth: 0, req });
    if (asset.visibility !== 'private' || idOf(asset.project) === null) continue;

    const references = await req.payload.find({
      collection: 'scenes',
      where: {
        or: [{ assets: { contains: id } }, { thumbnail: { equals: id } }],
      },
      depth: 0,
      limit: 1,
      req,
    });
    if (references.totalDocs === 0) {
      await req.payload.delete({ collection: 'assets', id, req });
    }
  }
}

export function sceneAssetIds(scene: { assets?: unknown; thumbnail?: unknown }): number[] {
  return [...(Array.isArray(scene.assets) ? scene.assets : []), scene.thumbnail]
    .map(idOf)
    .filter((id): id is number => id !== null);
}

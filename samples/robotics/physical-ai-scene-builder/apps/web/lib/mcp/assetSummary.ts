// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { objectModelConversion, type SceneAsset } from '@/lib/scenes/assetsApi';

export type McpAssetSource = 'generated' | 'custom' | 'primitive' | 'mesh';

/** The compact list_assets view of a library object; mirrors addAssetToScene's dispatch order. */
export function mcpAssetSummary(asset: SceneAsset) {
  const source: McpAssetSource = objectModelConversion(asset)
    ? 'generated'
    : asset.customSource
      ? 'custom'
      : asset.primitive
        ? 'primitive'
        : 'mesh';
  const dimensions = asset.metadata?.dimensionsMeters?.map((entry) => entry.value);
  return {
    id: asset.id,
    name: asset.name,
    source,
    category: asset.category,
    tags: asset.tags ?? [],
    processingStatus: asset.processingStatus,
    placeable: source !== 'mesh' || asset.processingStatus === 'ready',
    ...(dimensions?.length === 3 ? { dimensionsMeters: dimensions } : {}),
    ...(asset.primitive
      ? { primitive: { type: asset.primitive.type, size: asset.primitive.size } }
      : {}),
  };
}

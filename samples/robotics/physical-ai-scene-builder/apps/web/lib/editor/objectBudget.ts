// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { RuntimeFile } from '@mujoco-studio/mujoco';

import { referencedRuntimePaths } from '../scenes/assetReferences';

export interface ObjectAssetUsage {
  fileBytes: number;
  triangles: number;
  textureBytes: number;
}

const MiB = 1024 * 1024;
const MAX_SCENE_TRIANGLES = 1_000_000;
const MAX_TEXTURE_BYTES = 128 * MiB;
const MAX_STAGED_BYTES = 256 * MiB;
const usageCache = new WeakMap<Uint8Array, ObjectAssetUsage>();

function texturePixels(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47) {
    return view.getUint32(16) * view.getUint32(20);
  }
  if (bytes.length >= 4 && view.getUint16(0) === 0xffd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      ) {
        if (length < 7) break;
        return view.getUint16(offset + 5) * view.getUint16(offset + 7);
      }
      offset += length + 2;
    }
  }
  throw new Error('Could not read the generated texture dimensions. Use a valid PNG or JPEG.');
}

export function objectAssetUsage(file: RuntimeFile): ObjectAssetUsage {
  const cached = usageCache.get(file.bytes);
  if (cached) return cached;
  const usage = { fileBytes: file.bytes.byteLength, triangles: 0, textureBytes: 0 };
  if (/\.obj$/i.test(file.path)) {
    const text = new TextDecoder().decode(file.bytes);
    for (const match of text.matchAll(/^\s*f[ \t]+([^\r\n#]+)/gm)) {
      usage.triangles += Math.max(0, match[1].trim().split(/\s+/).length - 2);
    }
  } else if (/\.(png|jpe?g)$/i.test(file.path)) {
    usage.textureBytes = texturePixels(file.bytes) * 4;
  }
  usageCache.set(file.bytes, usage);
  return usage;
}

export function assertObjectSceneBudget(
  xml: string,
  files: readonly RuntimeFile[],
): ObjectAssetUsage {
  const referenced = new Set(referencedRuntimePaths(xml));
  const total = { fileBytes: 0, triangles: 0, textureBytes: 0 };
  for (const file of files) {
    if (file.kind === 'splat') continue;
    total.fileBytes += file.bytes.byteLength;
    if (!referenced.has(file.path)) continue;
    const usage = objectAssetUsage(file);
    total.triangles += usage.triangles;
    total.textureBytes += usage.textureBytes;
  }
  const exceeded =
    total.triangles > MAX_SCENE_TRIANGLES ||
    total.textureBytes > MAX_TEXTURE_BYTES ||
    total.fileBytes > MAX_STAGED_BYTES;
  if (exceeded) {
    throw new Error(
      `This import exceeds the browser scene budget: ${total.triangles.toLocaleString()} OBJ triangles ` +
        `(limit ${MAX_SCENE_TRIANGLES.toLocaleString()}), ${(total.textureBytes / MiB).toFixed(1)} MiB decoded textures ` +
        `(limit 128), ${(total.fileBytes / MiB).toFixed(1)} MiB staged assets (limit 256). ` +
        'Regenerate oversized objects with the simulation-ready profile or simplify them before importing. ' +
        'Save and reload the scene to release files retained only by undo history.',
    );
  }
  return total;
}

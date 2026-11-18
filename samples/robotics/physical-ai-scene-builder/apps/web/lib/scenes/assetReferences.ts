// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { normalizeRuntimePath, type RuntimeFile } from '@mujoco-studio/mujoco';

import { backdropFromGraph } from '@/lib/editor/texturePersistence';
import { obj2mjcfFileUrl } from '@/lib/scenes/obj2mjcfApi';
import { URL_CHARS } from '@/lib/http/urlChars';

import type { SceneAsset, SceneSummary } from './api';
import { sha256Hex } from './sha256';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg']);
/** Runtime path of a file obj2mjcf generated, served from `data/imageto3D/<id>` (not a Payload asset). */
const OBJECT_PATH_PATTERN = /^objects\/([^/]+)\/(.+)$/;

function assetIdForPath(path: string): number | null {
  const [, id] = path.split('/');
  const parsed = Number(id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function runtimeAssetIdForPath(path: string): number | null {
  return assetIdForPath(path);
}

/** Stored-asset directory for a runtime file: images live under `textures/`, the rest `assets/`. */
export function runtimeAssetDirectory(path: string): 'textures' | 'assets' | 'splats' {
  if (path.startsWith('splats/')) return 'splats';
  const extension = path.split('.').at(-1)?.toLowerCase() ?? '';
  return path.startsWith('textures/') || IMAGE_EXTENSIONS.has(extension) ? 'textures' : 'assets';
}

export function runtimeSplatPath(asset: SceneAsset): string {
  return `splats/${asset.id}/${sanitizedRuntimeFilename(asset.filename ?? 'scene.ply')}`;
}

export function sanitizedRuntimeFilename(path: string): string {
  const filename = path
    .split('/')
    .at(-1)
    ?.replace(/[^a-zA-Z0-9._-]/g, '_');
  return filename || 'scene-asset.bin';
}

function assetRecord(value: number | SceneAsset): SceneAsset | null {
  return typeof value === 'number' ? null : value;
}

function artifactRuntimeKind(path: string): 'canonical' | 'collision' | null {
  const kind = path.split('/')[2];
  return kind === 'canonical' || kind === 'collision' ? kind : null;
}

/** `file` plus the cube-map face attributes MuJoCo reads on `<texture>`. */
const FILE_ATTRIBUTES = [
  'file',
  'fileright',
  'fileleft',
  'fileup',
  'filedown',
  'filefront',
  'fileback',
] as const;
const FILE_ATTRIBUTE_SELECTOR = FILE_ATTRIBUTES.map((attribute) => `[${attribute}]`).join(', ');

export function referencedRuntimePaths(xml: string): string[] {
  if (typeof DOMParser === 'undefined') return [];
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('The scene MJCF is not valid XML.');
  const paths = new Set<string>();
  for (const element of document.querySelectorAll(FILE_ATTRIBUTE_SELECTOR)) {
    for (const attribute of FILE_ATTRIBUTES) {
      const file = element.getAttribute(attribute);
      if (file === null) continue;
      if (!file) throw new Error('The scene contains an empty asset path.');
      paths.add(normalizeRuntimePath(file));
    }
  }
  return [...paths];
}

export function rewriteRuntimePaths(xml: string, pathMap: ReadonlyMap<string, string>): string {
  if (!pathMap.size) return xml;
  if (typeof DOMParser === 'undefined')
    throw new Error('MJCF path rewriting requires a browser document.');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('The scene MJCF is not valid XML.');
  for (const element of document.querySelectorAll(FILE_ATTRIBUTE_SELECTOR)) {
    for (const attribute of FILE_ATTRIBUTES) {
      const file = element.getAttribute(attribute);
      if (!file) continue;
      const replacement = pathMap.get(normalizeRuntimePath(file));
      if (replacement) element.setAttribute(attribute, replacement);
    }
  }
  return new XMLSerializer().serializeToString(document);
}

export async function downloadSceneRuntimeFiles(scene: SceneSummary): Promise<RuntimeFile[]> {
  const xml = scene.mjcf ?? '';
  const paths = referencedRuntimePaths(xml);
  if (!paths.length) return [];

  const assets = new Map(
    (scene.assets ?? [])
      .map(assetRecord)
      .filter((asset): asset is SceneAsset => Boolean(asset))
      .map((asset) => [asset.id, asset]),
  );
  const runtimeFiles: RuntimeFile[] = [];

  for (const path of paths) {
    const objectMatch = OBJECT_PATH_PATTERN.exec(path);
    if (objectMatch) {
      const [, objectId, filename] = objectMatch;
      let fileUrl = '';
      for (const character of obj2mjcfFileUrl(objectId, filename)) {
        let allowedCharacter = '';
        for (const allowed of URL_CHARS) {
          if (allowed === character) {
            allowedCharacter = allowed;
            break;
          }
        }
        if (!allowedCharacter) {
          throw new Error(`Converted object file "${filename}" has an unsupported name.`);
        }
        fileUrl += allowedCharacter;
      }
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(
          `Could not download converted object file "${filename}" (HTTP ${response.status}).`,
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.byteLength) throw new Error(`Converted object file "${filename}" is empty.`);
      runtimeFiles.push({
        path,
        bytes,
        checksum: response.headers.get('etag') ?? `${objectId}-${filename}-${bytes.byteLength}`,
      });
      continue;
    }

    const assetId = assetIdForPath(path);
    const asset = assetId === null ? null : assets.get(assetId);
    if (!asset) {
      throw new Error(`Scene asset ${assetId ?? path} is not available for loading.`);
    }
    const artifactKind = artifactRuntimeKind(path);
    const artifact =
      artifactKind === 'collision'
        ? asset.collisionMesh && typeof asset.collisionMesh === 'object'
          ? asset.collisionMesh
          : null
        : artifactKind === 'canonical'
          ? asset.canonicalMesh && typeof asset.canonicalMesh === 'object'
            ? asset.canonicalMesh
            : null
          : null;
    if (artifactKind && !artifact?.filename) {
      throw new Error(`Scene asset "${asset.name}" has no ${artifactKind} mesh artifact.`);
    }
    const filename = artifact?.filename ?? asset.filename;
    if (!filename) throw new Error(`Scene asset "${asset.name}" has no file.`);

    const collection = artifact ? 'asset-artifacts' : 'assets';
    const response = await fetch(`\/api/${collection}/file/${encodeURIComponent(filename)}`);
    if (!response.ok) {
      throw new Error(`Could not download scene asset "${asset.name}" (HTTP ${response.status}).`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength) throw new Error(`Scene asset "${asset.name}" is empty.`);
    runtimeFiles.push({
      path,
      bytes,
      checksum: response.headers.get('etag') ?? `${asset.id}-${bytes.byteLength}`,
    });
  }

  return runtimeFiles;
}

/**
 * Downloads the scene's splat backdrop PLY, verifying it against the persisted hash. Returns null
 * when the scene has no backdrop; throws when it has one that cannot be loaded, which callers
 * report as a warning without blocking the scene.
 */
export async function downloadSceneSplat(scene: SceneSummary): Promise<RuntimeFile | null> {
  const backdrop = backdropFromGraph(scene.graph);
  if (!backdrop) return null;
  const asset = (scene.assets ?? [])
    .map(assetRecord)
    .find((value): value is SceneAsset => value?.id === backdrop.assetId);
  if (!asset || asset.kind !== 'splat' || !asset.filename) {
    throw new Error(`The splat backdrop file (asset ${backdrop.assetId}) is no longer available.`);
  }
  const response = await fetch(`/api/assets/file/${encodeURIComponent(asset.filename)}`);
  if (!response.ok) {
    throw new Error(`Could not download the splat backdrop (HTTP ${response.status}).`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const hash = await sha256Hex(bytes);
  if (hash !== backdrop.hash) {
    throw new Error('The downloaded splat backdrop does not match the file saved with this scene.');
  }
  return {
    path: runtimeSplatPath(asset),
    bytes,
    checksum: hash,
    kind: 'splat',
  };
}

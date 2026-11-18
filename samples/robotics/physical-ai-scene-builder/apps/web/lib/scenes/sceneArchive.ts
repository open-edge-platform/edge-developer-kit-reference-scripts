// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { strToU8, zipSync, type Zippable } from 'fflate';

import { normalizeRuntimePath, type RuntimeFile } from '@mujoco-studio/mujoco';
import { isSplatPath, MAX_SPLAT_BYTES, splatFileProblem } from '@mujoco-studio/types';
import { sha256Hex } from './sha256';

// Internal `.mujoco-scene` bundle handed to the native Generate/Evaluate workers. It keeps the
// editor's runtime asset paths verbatim so scene fingerprints and dataset keys stay stable. The
// user-facing import/export ZIP lives in ./scenePackage.ts.

const ARCHIVE_VERSION = 1;
/** The splat is the largest entry; meshes and textures are capped lower at upload. */
const MAX_ENTRY_BYTES = MAX_SPLAT_BYTES;
/** Expanded bundle limit of the worker (`MAX_ARCHIVE_BYTES` in `scene_bundle.py`). */
const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024;

const SUPPORTED_FILE_EXTENSIONS = new Set([
  'glb',
  'obj',
  'stl',
  'png',
  'jpg',
  'jpeg',
  'ply',
  'spz',
]);

export interface SceneArchiveManifestFile {
  path: string;
  kind: 'mesh' | 'texture' | 'splat';
  size: number;
  sha256: string;
}

export interface SceneArchiveManifest {
  version: typeof ARCHIVE_VERSION;
  sceneName: string;
  entrypoint: 'scene.xml';
  files: SceneArchiveManifestFile[];
}

function archiveError(message: string): Error {
  return new Error(`Scene bundle is invalid: ${message}`);
}

function extensionFor(path: string): string {
  return path.split('.').at(-1)?.toLowerCase() ?? '';
}

function kindFor(
  path: string,
  declaredKind?: RuntimeFile['kind'],
): SceneArchiveManifestFile['kind'] {
  if (declaredKind) return declaredKind;
  if (isSplatPath(path)) return 'splat';
  return path.startsWith('textures/') || ['png', 'jpg', 'jpeg'].includes(extensionFor(path))
    ? 'texture'
    : 'mesh';
}

function validateArchivePath(path: string, kind?: SceneArchiveManifestFile['kind']): string {
  if (!path || path.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(path)) {
    throw archiveError(`asset path "${path}" must be relative`);
  }
  const normalized = normalizeRuntimePath(path);
  if (normalized === 'manifest.json' || normalized === 'scene.xml') {
    throw archiveError(`asset path "${path}" is reserved`);
  }
  if (!SUPPORTED_FILE_EXTENSIONS.has(extensionFor(normalized))) {
    throw archiveError(`asset path "${path}" uses an unsupported file type`);
  }
  if (isSplatPath(normalized) && kind !== 'splat') {
    throw archiveError(`PLY/SPZ asset "${path}" must be declared as a splat`);
  }
  if (kind === 'splat' && (!normalized.startsWith('splats/') || !isSplatPath(normalized))) {
    throw archiveError(`splat asset "${path}" must be a splats/*.ply or splats/*.spz path`);
  }
  return normalized;
}

function validateSceneXml(xml: string, assetPaths?: Set<string>): void {
  if (!xml.trim()) throw archiveError('scene.xml is empty');
  if (/<\s*include\b/i.test(xml)) {
    throw archiveError('MJCF include elements are not supported in bundles');
  }
  if (typeof DOMParser === 'undefined') return;

  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror') || document.documentElement.nodeName !== 'mujoco') {
    throw archiveError('scene.xml is not a valid MuJoCo document');
  }
  for (const element of document.querySelectorAll('[file], [meshdir], [texturedir]')) {
    for (const attribute of ['file', 'meshdir', 'texturedir']) {
      const value = element.getAttribute(attribute);
      if (value && /^[a-z][a-z\d+.-]*:/i.test(value)) {
        throw archiveError('external MJCF asset URLs are not supported');
      }
    }
  }
  if (!assetPaths) return;
  for (const element of document.querySelectorAll('[file]')) {
    const file = element.getAttribute('file');
    if (!file) throw archiveError('an MJCF file reference is empty');
    const normalized = validateArchivePath(file);
    if (!assetPaths.has(normalized)) {
      throw archiveError(`scene.xml references missing asset "${normalized}"`);
    }
  }
}

function validateFileSize(path: string, bytes: Uint8Array): void {
  if (!bytes.byteLength) throw archiveError(`asset "${path}" is empty`);
  if (bytes.byteLength > MAX_ENTRY_BYTES) {
    throw archiveError(`asset "${path}" exceeds the ${MAX_ENTRY_BYTES} byte limit`);
  }
}

function validateSplatFile(path: string, bytes: Uint8Array): void {
  const problem = splatFileProblem(bytes);
  if (problem) throw archiveError(`splat "${path}" is not a valid splat: ${problem}`);
}

export async function exportSceneArchive(
  xml: string,
  sceneName: string,
  runtimeFiles: readonly RuntimeFile[],
): Promise<Blob> {
  validateSceneXml(xml);
  const sceneXml = strToU8(xml);
  const entries: Zippable = { 'scene.xml': sceneXml };
  const seenPaths = new Set<string>();
  const manifestFiles: SceneArchiveManifestFile[] = [];

  let splatPath: string | null = null;
  // The worker's expanded-size limit, checked before hashing so an oversized scene fails here
  // instead of after uploading it.
  let expanded = sceneXml.byteLength;
  for (const runtimeFile of runtimeFiles) {
    const kind = kindFor(runtimeFile.path, runtimeFile.kind);
    const path = validateArchivePath(runtimeFile.path, kind);
    if (seenPaths.has(path)) throw archiveError(`asset path "${path}" is duplicated`);
    validateFileSize(path, runtimeFile.bytes);
    expanded += runtimeFile.bytes.byteLength;
    if (expanded > MAX_EXPANDED_BYTES) {
      throw archiveError('the scene and its assets exceed the 1 GiB worker bundle limit');
    }
    if (kind === 'splat') {
      if (splatPath) {
        throw archiveError(`only one splat backdrop is supported ("${splatPath}", "${path}")`);
      }
      splatPath = path;
      validateSplatFile(path, runtimeFile.bytes);
    }
    seenPaths.add(path);
    // Splat PLYs are large float data that deflate shrinks by ~10%. Deflating one (synchronously,
    // on the browser main thread) took seconds and the worker then inflated it again, so it is
    // stored uncompressed.
    entries[path] = kind === 'splat' ? [runtimeFile.bytes, { level: 0 }] : runtimeFile.bytes;
    manifestFiles.push({
      path,
      kind,
      size: runtimeFile.bytes.byteLength,
      sha256:
        kind === 'splat' && /^[0-9a-f]{64}$/i.test(runtimeFile.checksum)
          ? runtimeFile.checksum.toLowerCase()
          : await sha256Hex(runtimeFile.bytes),
    });
  }

  if (sceneXml.byteLength > MAX_ENTRY_BYTES) {
    throw archiveError('scene.xml exceeds the entry size limit');
  }

  const manifest: SceneArchiveManifest = {
    version: ARCHIVE_VERSION,
    sceneName: sceneName.trim() || 'Untitled scene',
    entrypoint: 'scene.xml',
    files: manifestFiles,
  };
  validateSceneXml(xml, new Set(manifestFiles.map((file) => file.path)));
  entries['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  return new Blob([zipSync(entries)], { type: 'application/zip' });
}

export function xmlFilename(sceneName: string): string {
  const normalized = sceneName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${normalized || 'scene'}.xml`;
}

export function downloadSceneArchive(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadSceneXml(xml: string, filename: string): void {
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

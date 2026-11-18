// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { RuntimeFile } from '@mujoco-studio/mujoco';
import { GeomType, type SceneGraph } from '@mujoco-studio/types';

import type { SceneAsset } from '../scenes/api';
import { obj2mjcfFileUrl } from '../scenes/obj2mjcfApi';

import type { BoxFace } from './document';
import {
  isFiniteVec3,
  normalizeSplatCalibration,
  type SplatCalibration,
  type Vec3Tuple,
} from './splatCollision';

const BOX_FACES = new Set<BoxFace>(['right', 'left', 'top', 'bottom', 'front', 'back']);
/** Runtime path of a file obj2mjcf generated, served from `data/imageto3D/<id>` (not a Payload asset). */
const OBJECT_PATH_PATTERN = /^objects\/([^/]+)\/(.+)$/;

export interface PersistedTextureFace {
  geomName: string;
  materialName: string;
  face: BoxFace;
}

export type PersistedTextureFaces = Record<string, PersistedTextureFace>;

export interface PersistedHomePoseV1 {
  version: 1;
  jointPositions: Record<string, number>;
}

/**
 * The scene's splat backdrop file and calibration. The pose and collision heightfield live in the
 * MJCF (`rs_backdrop` body); the heightfield and surface are re-derived from the PLY on load.
 */
export interface PersistedBackdropV2 {
  version: 2;
  assetId: number;
  /** SHA-256 hex of the PLY bytes; checked on download and used to skip re-uploads. */
  hash: string;
  calibration: SplatCalibration;
  /** Alignment origin of `calibration`; recalibration offsets the body by the origin change. */
  origin: Vec3Tuple;
}

/** A validated persisted backdrop record. */
export type PersistedBackdrop = Omit<PersistedBackdropV2, 'version'>;

export interface PersistedSceneEditorMetadata {
  textureFaces?: PersistedTextureFaces;
  homePose?: PersistedHomePoseV1;
  backdrop?: PersistedBackdropV2;
}

const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/** Owns browser URLs for imported image bytes for exactly as long as their runtime files are used. */
export class RuntimeTextureUrlRegistry {
  private readonly urls = new Map<string, { checksum: string; url: string }>();

  sync(runtimeFiles: readonly RuntimeFile[]): void {
    const images = new Map(
      runtimeFiles
        .map((file) => [normalizePath(file.path), file] as const)
        .filter(([path]) => IMAGE_MIME_TYPES[extensionOf(path)]),
    );

    for (const [path, current] of this.urls) {
      if (images.get(path)?.checksum !== current.checksum) {
        URL.revokeObjectURL(current.url);
        this.urls.delete(path);
      }
    }

    for (const [path, file] of images) {
      if (this.urls.has(path)) continue;
      const mimeType = IMAGE_MIME_TYPES[extensionOf(path)];
      const blob = new Blob([file.bytes.slice().buffer], { type: mimeType });
      this.urls.set(path, { checksum: file.checksum, url: URL.createObjectURL(blob) });
    }
  }

  get(path: string): string | null {
    return this.urls.get(normalizePath(path))?.url ?? null;
  }

  dispose(): void {
    for (const { url } of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

function extensionOf(path: string): string {
  return path.split('.').at(-1)?.toLowerCase() ?? '';
}

export interface PersistedSceneGraph extends SceneGraph {
  editor?: PersistedSceneEditorMetadata;
}

function parse(xml: string): Document | null {
  if (typeof DOMParser === 'undefined') return null;
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  return document.querySelector('parsererror') ? null : document;
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\/+/, '');
}

function assetRecords(assets: readonly (number | SceneAsset)[]): ReadonlyMap<number, SceneAsset> {
  return new Map(
    assets
      .filter((asset): asset is SceneAsset => typeof asset !== 'number')
      .map((asset) => [asset.id, asset]),
  );
}

function isBoxFace(value: unknown): value is BoxFace {
  return typeof value === 'string' && BOX_FACES.has(value as BoxFace);
}

export function textureUrlForRuntimePath(
  path: string,
  assets: readonly (number | SceneAsset)[],
): string | null {
  const normalizedPath = normalizePath(path);
  const objectMatch = OBJECT_PATH_PATTERN.exec(normalizedPath);
  if (objectMatch) {
    const [, objectId, filename] = objectMatch;
    return obj2mjcfFileUrl(objectId, filename);
  }
  const [, assetIdValue] = normalizedPath.split('/');
  const assetId = Number(assetIdValue);
  if (!normalizedPath.startsWith('textures/') || !Number.isInteger(assetId) || assetId < 1) {
    return null;
  }
  const asset = assetRecords(assets).get(assetId);
  if (!asset?.filename) return null;
  return `/api/assets/file/${encodeURIComponent(asset.filename)}`;
}

export function extractTextureUrlsFromMjcf(
  xml: string,
  runtimeFiles: readonly RuntimeFile[],
  assets: readonly (number | SceneAsset)[],
  runtimeTextureUrl?: (path: string) => string | null,
): Record<string, string> {
  const document = parse(xml);
  if (!document) return {};

  const runtimePaths = new Set(runtimeFiles.map((file) => normalizePath(file.path)));
  const assetSection = document.querySelector(':scope > asset');
  if (!assetSection) return {};

  const textures = new Map(
    [...assetSection.querySelectorAll(':scope > texture')]
      .map((texture) => [texture.getAttribute('name'), texture.getAttribute('file')] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1])),
  );
  const urls: Record<string, string> = {};
  for (const material of assetSection.querySelectorAll(':scope > material[texture]')) {
    const materialName = material.getAttribute('name');
    const textureName = material.getAttribute('texture');
    const file = textureName ? textures.get(textureName) : null;
    const normalizedFile = file ? normalizePath(file) : null;
    if (!materialName || !normalizedFile) continue;
    if (!runtimePaths.has(normalizedFile)) {
      console.warn(
        `Texture "${textureName}" for material "${materialName}" references "${normalizedFile}", but that file is not staged in the scene runtime.`,
      );
      continue;
    }
    const url =
      runtimeTextureUrl?.(normalizedFile) ??
      textureUrlForRuntimePath(normalizedFile, assets) ??
      null;
    if (url) {
      urls[materialName] = url;
    } else {
      console.warn(
        `Texture "${textureName}" for material "${materialName}" references staged file "${normalizedFile}", but no browser texture URL is available.`,
      );
    }
  }
  return urls;
}

export function textureFacesForGraph(
  graph: SceneGraph | null,
  textureFaceByGeom: Readonly<Record<string, BoxFace>>,
): PersistedTextureFaces {
  if (!graph) return {};
  const faces: PersistedTextureFaces = {};
  for (const [geomId, face] of Object.entries(textureFaceByGeom)) {
    const node = graph.nodes[geomId];
    if (
      !node ||
      node.kind !== 'geom' ||
      node.geomType !== GeomType.Box ||
      !node.materialName ||
      !isBoxFace(face)
    ) {
      continue;
    }
    faces[geomId] = {
      geomName: node.name,
      materialName: node.materialName,
      face,
    };
  }
  return faces;
}

export function graphWithTextureFaces(
  graph: SceneGraph,
  textureFaceByGeom: Readonly<Record<string, BoxFace>>,
): PersistedSceneGraph {
  const textureFaces = textureFacesForGraph(graph, textureFaceByGeom);
  return graphWithEditorMetadata(graph, { textureFaces });
}

export function graphWithEditorMetadata(
  graph: SceneGraph,
  metadata: {
    textureFaces?: PersistedTextureFaces | null;
    homePose?: PersistedHomePoseV1 | null;
    backdrop?: PersistedBackdropV2 | null;
  },
): PersistedSceneGraph {
  const existingEditor: PersistedSceneEditorMetadata =
    graph && 'editor' in graph && graph.editor ? { ...graph.editor } : {};
  if (metadata.textureFaces && Object.keys(metadata.textureFaces).length) {
    existingEditor.textureFaces = metadata.textureFaces;
  } else if (metadata.textureFaces === null) {
    delete existingEditor.textureFaces;
  }
  if (metadata.homePose) existingEditor.homePose = metadata.homePose;
  else if (metadata.homePose === null) delete existingEditor.homePose;
  if (metadata.backdrop) existingEditor.backdrop = metadata.backdrop;
  else if (metadata.backdrop === null) delete existingEditor.backdrop;
  if (!Object.keys(existingEditor).length) return graph;
  return { ...graph, editor: existingEditor };
}

export function backdropFromGraph(value: unknown): PersistedBackdrop | null {
  if (!value || typeof value !== 'object') return null;
  const editor = (value as { editor?: unknown }).editor;
  const backdrop =
    editor && typeof editor === 'object' ? (editor as { backdrop?: unknown }).backdrop : null;
  return parseBackdrop(backdrop);
}

/** A persisted backdrop record (scene graph or local revision), validated; null if invalid. */
export function parseBackdrop(backdrop: unknown): PersistedBackdrop | null {
  if (!backdrop || typeof backdrop !== 'object') return null;
  const candidate = backdrop as Record<string, unknown>;
  if (
    candidate.version !== 2 ||
    typeof candidate.assetId !== 'number' ||
    !Number.isInteger(candidate.assetId) ||
    candidate.assetId < 1 ||
    typeof candidate.hash !== 'string' ||
    !candidate.hash ||
    !isFiniteVec3(candidate.origin)
  ) {
    return null;
  }
  return {
    assetId: candidate.assetId,
    hash: candidate.hash,
    calibration: normalizeSplatCalibration(candidate.calibration),
    origin: candidate.origin,
  };
}

export function textureFacesFromGraph(
  persistedGraph: unknown,
  graph: SceneGraph | null,
): Record<string, BoxFace> {
  if (!graph || !persistedGraph || typeof persistedGraph !== 'object') return {};
  const editor = (persistedGraph as { editor?: unknown }).editor;
  if (!editor || typeof editor !== 'object') return {};
  const textureFaces = (editor as { textureFaces?: unknown }).textureFaces;
  if (!textureFaces || typeof textureFaces !== 'object') return {};

  const hydrated: Record<string, BoxFace> = {};
  for (const [geomId, value] of Object.entries(textureFaces)) {
    if (!value || typeof value !== 'object') continue;
    const selection = value as Partial<PersistedTextureFace>;
    const directNode = graph.nodes[geomId];
    const node =
      directNode ??
      Object.values(graph.nodes).find(
        (candidate) =>
          candidate.kind === 'geom' &&
          candidate.name === selection.geomName &&
          candidate.materialName === selection.materialName,
      );
    if (
      !node ||
      node.kind !== 'geom' ||
      node.geomType !== GeomType.Box ||
      typeof selection.geomName !== 'string' ||
      selection.geomName !== node.name ||
      typeof selection.materialName !== 'string' ||
      selection.materialName !== node.materialName ||
      !isBoxFace(selection.face)
    ) {
      continue;
    }
    hydrated[node.id] = selection.face;
  }
  return hydrated;
}

export function homePoseFromGraph(persistedGraph: unknown): PersistedHomePoseV1 | null {
  if (!persistedGraph || typeof persistedGraph !== 'object') return null;
  const editor = (persistedGraph as { editor?: unknown }).editor;
  if (!editor || typeof editor !== 'object') return null;
  const homePose = (editor as { homePose?: unknown }).homePose;
  if (!homePose || typeof homePose !== 'object' || Array.isArray(homePose)) return null;
  const candidate = homePose as { version?: unknown; jointPositions?: unknown };
  if (candidate.version !== 1 || !candidate.jointPositions) return null;
  if (typeof candidate.jointPositions !== 'object' || Array.isArray(candidate.jointPositions)) {
    return null;
  }
  const jointPositions: Record<string, number> = {};
  for (const [name, value] of Object.entries(candidate.jointPositions)) {
    if (!name || typeof value !== 'number' || !Number.isFinite(value)) return null;
    jointPositions[name] = value;
  }
  return Object.keys(jointPositions).length ? { version: 1, jointPositions } : null;
}

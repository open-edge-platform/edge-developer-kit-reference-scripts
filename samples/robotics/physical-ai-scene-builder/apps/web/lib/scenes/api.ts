// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { RuntimeFile } from '@mujoco-studio/mujoco';
import { splatFilename, splatFormatOf } from '@mujoco-studio/types';
import { deleteCachedSplat } from '../editor/splatCache';
import { URL_CHARS } from '../http/urlChars';

export interface ProjectSummary {
  id: number;
  name: string;
  slug?: string | null;
  description?: string | null;
  updatedAt?: string;
  createdAt?: string;
}

export interface SceneAssetArtifact {
  id: number;
  filename?: string | null;
  url?: string | null;
  mimeType?: string | null;
}

export interface SceneAsset {
  id: number;
  name: string;
  kind: 'mesh' | 'splat' | 'texture' | 'material';
  filename?: string | null;
  url?: string | null;
  mimeType?: string | null;
  project?: number | { id: number } | null;
  visibility: 'private' | 'library';
  metadata?: {
    unit?: 'm' | 'cm' | 'mm' | null;
    upAxis?: 'y' | 'z' | null;
    collisionStrategy?: 'box' | 'convex-hull' | 'none' | null;
    dimensionsMeters?: { value: number }[] | null;
  } | null;
  canonicalMesh?: number | SceneAssetArtifact | null;
  collisionMesh?: number | SceneAssetArtifact | null;
  thumbnail?: number | SceneAssetArtifact | null;
}

export interface RobotMesh {
  id: number;
  filename: string | null;
  sourceFilename: string | null;
  tags: string[];
}

export interface RobotSummary {
  id: number;
  name: string;
  slug?: string | null;
  description?: string | null;
  manufacturer?: string | null;
  mjcf: string;
  meshes: RobotMesh[];
  tags: string[];
}

export interface RobotPage {
  docs: RobotSummary[];
  hasNextPage: boolean;
  nextPage: number | null;
}

export interface SceneSummary {
  id: number;
  name: string;
  project?: number | ProjectSummary | null;
  isTemplate?: boolean;
  graph?: unknown;
  mjcf?: string | null;
  assets?: (number | SceneAsset)[] | null;
  updatedAt?: string;
  createdAt?: string;
}

export interface PaginatedPage<T> {
  docs: T[];
  page: number;
  totalPages: number;
  totalDocs: number;
  hasNextPage: boolean;
  nextPage: number | null;
}

interface PayloadListResponse<T> {
  docs: T[];
  totalDocs?: number;
  page?: number;
  totalPages?: number;
  hasNextPage?: boolean;
  nextPage?: number | null;
}

interface PayloadDocumentResponse<T> {
  doc?: T;
}

function sourceFilenameFromTags(tags: string[]): string | null {
  const sourceTag = tags.find((tag) => tag.startsWith('source:'));
  return sourceTag?.slice('source:'.length) || null;
}

function normalizeRobotMesh(value: unknown): RobotMesh | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'number' ? record.id : Number(record.id);
  if (!Number.isInteger(id) || id < 1) return null;
  const tags = Array.isArray(record.tags)
    ? record.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];
  return {
    id,
    filename: typeof record.filename === 'string' ? record.filename : null,
    sourceFilename: sourceFilenameFromTags(tags),
    tags,
  };
}

function normalizeRobot(value: unknown): RobotSummary {
  const record = value as Record<string, unknown>;
  const meshes = Array.isArray(record.meshes)
    ? record.meshes.map(normalizeRobotMesh).filter((mesh): mesh is RobotMesh => Boolean(mesh))
    : [];
  return {
    id: Number(record.id),
    name: typeof record.name === 'string' ? record.name : 'Unnamed robot',
    slug: typeof record.slug === 'string' ? record.slug : null,
    description: typeof record.description === 'string' ? record.description : null,
    manufacturer: typeof record.manufacturer === 'string' ? record.manufacturer : null,
    mjcf: typeof record.mjcf === 'string' ? record.mjcf : '',
    meshes,
    tags: Array.isArray(record.tags)
      ? record.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
  };
}

export class PayloadApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'PayloadApiError';
    this.status = status;
  }
}

function documentFromResponse<T>(value: T | PayloadDocumentResponse<T>): T {
  if (value && typeof value === 'object' && 'doc' in value && value.doc) {
    return value.doc;
  }
  return value as T;
}

function errorMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object') return fallback;
  const response = value as { message?: unknown; errors?: { message?: unknown }[] };
  if (typeof response.message === 'string') return response.message;
  const firstError = response.errors?.find((error) => typeof error.message === 'string');
  return typeof firstError?.message === 'string' ? firstError.message : fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let url = '';
  for (const character of path) {
    let allowedCharacter = '';
    for (const allowed of URL_CHARS) {
      if (allowed === character) {
        allowedCharacter = allowed;
        break;
      }
    }
    if (!allowedCharacter) throw new PayloadApiError('The request path is not supported.', 400);
    url += allowedCharacter;
  }
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new PayloadApiError(
      errorMessage(body, `Request failed with status ${response.status}.`),
      response.status,
    );
  }
  return body as T;
}

function paginatedPage<T>(
  response: PayloadListResponse<T>,
  requestedPage: number,
  requestedLimit: number,
): PaginatedPage<T> {
  const totalDocs = response.totalDocs ?? response.docs.length;
  const totalPages =
    response.totalPages ?? Math.max(1, Math.ceil(totalDocs / Math.max(requestedLimit, 1)));
  const page = response.page ?? requestedPage;
  const hasNextPage = response.hasNextPage ?? page < totalPages;
  return {
    docs: response.docs,
    page,
    totalPages,
    totalDocs,
    hasNextPage,
    nextPage: response.nextPage ?? (hasNextPage ? page + 1 : null),
  };
}

export async function listProjects({
  page = 1,
  limit = 8,
}: { page?: number; limit?: number } = {}): Promise<PaginatedPage<ProjectSummary>> {
  const params = new URLSearchParams({
    depth: '1',
    limit: String(limit),
    page: String(page),
    sort: 'name',
  });
  const response = await request<PayloadListResponse<ProjectSummary>>(`/api/projects?${params}`);
  return paginatedPage(response, page, limit);
}

export async function getProject(projectId: number): Promise<ProjectSummary> {
  const response = await request<ProjectSummary | PayloadDocumentResponse<ProjectSummary>>(
    `/api/projects/${projectId}?depth=1`,
  );
  return documentFromResponse(response);
}

export async function listRobots({
  page = 1,
  limit = 24,
  search = '',
  tag = '',
}: {
  page?: number;
  limit?: number;
  search?: string;
  tag?: string;
} = {}): Promise<RobotPage> {
  const parameters = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    depth: '1',
    sort: 'name',
  });
  let conditionIndex = 0;
  if (search) {
    parameters.set(`where[and][${conditionIndex}][or][0][name][like]`, search);
    parameters.set(`where[and][${conditionIndex}][or][1][manufacturer][like]`, search);
    parameters.set(`where[and][${conditionIndex}][or][2][tags][contains]`, search);
    conditionIndex++;
  }
  if (tag) parameters.set(`where[and][${conditionIndex}][tags][contains]`, tag);

  const response = await request<PayloadListResponse<unknown>>(`/api/robots?${parameters}`);
  return {
    docs: response.docs.map(normalizeRobot),
    hasNextPage: Boolean(
      (response as PayloadListResponse<unknown> & { hasNextPage?: boolean }).hasNextPage,
    ),
    nextPage:
      (response as PayloadListResponse<unknown> & { nextPage?: number | null }).nextPage ?? null,
  };
}

export async function listRobotMeshReferences(): Promise<RobotMesh[]> {
  const meshes = new Map<number, RobotMesh>();
  let page = 1;

  for (;;) {
    const robotPage = await listRobots({ page });
    for (const robot of robotPage.docs) {
      for (const mesh of robot.meshes) meshes.set(mesh.id, mesh);
    }

    if (!robotPage.hasNextPage) break;
    page = robotPage.nextPage ?? page + 1;
  }

  return [...meshes.values()].sort((left, right) => left.id - right.id);
}

export async function getRobot(robotId: number): Promise<RobotSummary> {
  const response = await request<unknown>(`/api/robots/${robotId}?depth=1`);
  return normalizeRobot(documentFromResponse(response));
}

export async function createProject(name: string, description?: string): Promise<ProjectSummary> {
  const response = await request<ProjectSummary | PayloadDocumentResponse<ProjectSummary>>(
    '/api/projects',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        ...(description?.trim() ? { description: description.trim() } : {}),
      }),
    },
  );
  return documentFromResponse(response);
}

export async function updateProject(
  projectId: number,
  input: { name: string; description?: string },
): Promise<ProjectSummary> {
  const response = await request<ProjectSummary | PayloadDocumentResponse<ProjectSummary>>(
    `/api/projects/${projectId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: input.name.trim(),
        description: input.description?.trim() ?? '',
      }),
    },
  );
  return documentFromResponse(response);
}

export async function deleteScene(sceneId: number): Promise<void> {
  await request<unknown>(`/api/scenes/${sceneId}`, { method: 'DELETE' });
  await deleteCachedSplat(sceneId).catch(() => {});
}

export async function deleteProject(projectId: number): Promise<void> {
  const scenes = await listScenes(projectId, { limit: 1000 });
  await request<unknown>(`/api/projects/${projectId}`, { method: 'DELETE' });
  await Promise.all(scenes.docs.map((scene) => deleteCachedSplat(scene.id).catch(() => {})));
}

export async function listScenes(
  projectId: number,
  { page = 1, limit = 8, isTemplate }: { page?: number; limit?: number; isTemplate?: boolean } = {},
): Promise<PaginatedPage<SceneSummary>> {
  const params = new URLSearchParams({
    depth: '1',
    limit: String(limit),
    page: String(page),
    sort: '-updatedAt',
    'where[project][equals]': String(projectId),
  });
  if (isTemplate !== undefined) params.set('where[isTemplate][equals]', String(isTemplate));
  const response = await request<PayloadListResponse<SceneSummary>>(`/api/scenes?${params}`);
  return paginatedPage(response, page, limit);
}

export async function listTemplates({
  page = 1,
  limit = 100,
}: { page?: number; limit?: number } = {}): Promise<PaginatedPage<SceneSummary>> {
  const params = new URLSearchParams({
    depth: '1',
    limit: String(limit),
    page: String(page),
    sort: 'name',
    'where[isTemplate][equals]': 'true',
  });
  const response = await request<PayloadListResponse<SceneSummary>>(`/api/scenes?${params}`);
  return paginatedPage(response, page, limit);
}

export async function listAllTemplates(): Promise<SceneSummary[]> {
  const templates: SceneSummary[] = [];
  let page = 1;
  while (true) {
    const result = await listTemplates({ page });
    templates.push(...result.docs);
    if (!result.hasNextPage) return templates;
    page = result.nextPage ?? page + 1;
  }
}

export async function getScene(sceneId: number): Promise<SceneSummary> {
  const response = await request<SceneSummary | PayloadDocumentResponse<SceneSummary>>(
    `/api/scenes/${sceneId}?depth=2`,
  );
  return documentFromResponse(response);
}

export interface SaveSceneInput {
  name: string;
  project: number | null;
  mjcf: string;
  graph: unknown;
  assets?: number[];
  isTemplate?: boolean;
}

export async function createScene(input: SaveSceneInput): Promise<SceneSummary> {
  const response = await request<SceneSummary | PayloadDocumentResponse<SceneSummary>>(
    '/api/scenes',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return documentFromResponse(response);
}
export async function updateScene(sceneId: number, input: SaveSceneInput): Promise<SceneSummary> {
  const updateInput = {
    name: input.name,
    mjcf: input.mjcf,
    graph: input.graph,
    ...(input.assets ? { assets: input.assets } : {}),
    ...(input.isTemplate !== undefined ? { isTemplate: input.isTemplate } : {}),
  };
  const response = await request<SceneSummary | PayloadDocumentResponse<SceneSummary>>(
    `/api/scenes/${sceneId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateInput),
    },
  );
  return documentFromResponse(response);
}

export async function updateSceneName(sceneId: number, name: string): Promise<SceneSummary> {
  const response = await request<SceneSummary | PayloadDocumentResponse<SceneSummary>>(
    `/api/scenes/${sceneId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    },
  );
  return documentFromResponse(response);
}

function runtimeAssetKind(path: string): 'mesh' | 'texture' {
  const extension = path.split('.').at(-1)?.toLowerCase();
  return path.startsWith('textures/') || ['png', 'jpg', 'jpeg'].includes(extension ?? '')
    ? 'texture'
    : 'mesh';
}

function runtimeFilename(path: string): string {
  const filename = path
    .split('/')
    .at(-1)
    ?.replace(/[^a-zA-Z0-9._-]/g, '_');
  return filename || 'scene-asset.bin';
}

function runtimeMimeType(path: string): string {
  switch (path.split('.').at(-1)?.toLowerCase()) {
    case 'glb':
      return 'model/gltf-binary';
    case 'obj':
      return 'model/obj';
    case 'stl':
      return 'model/stl';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

/** Uploads `file` as a private project asset of `kind`. */
async function postAsset(
  projectId: number,
  file: File,
  kind: 'mesh' | 'splat' | 'texture',
): Promise<SceneAsset> {
  const body = new FormData();
  body.append('file', file);
  body.append(
    '_payload',
    JSON.stringify({
      name: file.name.replace(/\.[^.]+$/, ''),
      kind,
      category: 'general',
      project: projectId,
      visibility: 'private',
    }),
  );
  const response = await request<SceneAsset | PayloadDocumentResponse<SceneAsset>>('/api/assets', {
    method: 'POST',
    body,
  });
  return documentFromResponse(response);
}

/** Uploads a staged mesh or texture referenced by the MJCF (splats use `uploadSplatAsset`). */
export async function uploadRuntimeAsset(
  projectId: number,
  runtimeFile: RuntimeFile,
): Promise<SceneAsset> {
  const filename = runtimeFilename(runtimeFile.path);
  const bytes = new Uint8Array(runtimeFile.bytes.byteLength);
  bytes.set(runtimeFile.bytes);
  const file = new File([bytes.buffer], filename, { type: runtimeMimeType(runtimeFile.path) });
  return postAsset(projectId, file, runtimeAssetKind(runtimeFile.path));
}

/** Uploads a splat backdrop (PLY or SPZ) as a private `splat` asset, streaming the Blob without copies. */
export async function uploadSplatAsset(
  projectId: number,
  file: Blob,
  filename = 'backdrop',
): Promise<SceneAsset> {
  // The stored extension follows the content, which is what the native worker path checks expect.
  const format = splatFormatOf(new Uint8Array(await file.slice(0, 2).arrayBuffer()));
  const name = runtimeFilename(splatFilename(filename, format));
  return postAsset(
    projectId,
    new File([file], name, { type: 'application/octet-stream' }),
    'splat',
  );
}

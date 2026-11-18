// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { PersistedBackdropV2 } from '../editor/texturePersistence';

const MAX_REVISIONS = 50;
const MAX_REVISION_STORAGE_CHARS = 1_000_000;

type RevisionStorage = Pick<Storage, 'getItem'> & Record<string, unknown>;

interface SceneRevisionHomePose {
  version: 1;
  jointPositions: Record<string, number>;
}

export interface SceneRevision {
  id: string;
  sceneId: number;
  name: string;
  xml: string;
  homePose?: SceneRevisionHomePose | null;
  /** Splat backdrop calibration the revision's heightfield was derived from (parse on use). */
  backdrop?: PersistedBackdropV2 | null;
  createdAt: string;
}

function storageKey(projectId: number, sceneId: number): string {
  return `mujoco-studio:revisions:${projectId}:${sceneId}`;
}

function isRevision(value: unknown): value is SceneRevision {
  if (!value || typeof value !== 'object') return false;
  const revision = value as Partial<SceneRevision>;
  return (
    typeof revision.id === 'string' &&
    typeof revision.sceneId === 'number' &&
    typeof revision.name === 'string' &&
    typeof revision.xml === 'string' &&
    (revision.homePose === undefined ||
      revision.homePose === null ||
      isHomePose(revision.homePose)) &&
    typeof revision.createdAt === 'string'
  );
}

function isHomePose(value: unknown): value is SceneRevisionHomePose {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const pose = value as Partial<SceneRevisionHomePose>;
  if (pose.version !== 1 || !pose.jointPositions || typeof pose.jointPositions !== 'object') {
    return false;
  }
  return Object.entries(pose.jointPositions).every(
    ([name, position]) =>
      Boolean(name) && typeof position === 'number' && Number.isFinite(position),
  );
}

export function listSceneRevisions(projectId: number, sceneId: number): SceneRevision[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(projectId, sceneId)) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value
      .filter(isRevision)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch {
    return [];
  }
}

export function recordSceneRevision(
  projectId: number,
  sceneId: number,
  name: string,
  xml: string,
  {
    homePose,
    backdrop,
  }: { homePose?: SceneRevisionHomePose | null; backdrop?: PersistedBackdropV2 | null } = {},
  storage: RevisionStorage | null = typeof window === 'undefined' ? null : window.localStorage,
): SceneRevision | null {
  if (!storage || !xml.trim()) return null;
  const revision: SceneRevision = {
    id: `${Date.now()}-${crypto.randomUUID()}`,
    sceneId,
    name: name.trim() || 'Untitled scene',
    xml,
    ...(homePose
      ? { homePose: { version: 1, jointPositions: { ...homePose.jointPositions } } }
      : {}),
    ...(backdrop ? { backdrop } : {}),
    createdAt: new Date().toISOString(),
  };
  let existing: SceneRevision[] = [];
  try {
    const value = JSON.parse(storage.getItem(storageKey(projectId, sceneId)) ?? '[]');
    if (Array.isArray(value)) existing = value.filter(isRevision);
  } catch {
    existing = [];
  }
  const revisions = [revision, ...existing]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_REVISIONS);
  let serialized = JSON.stringify(revisions);
  while (revisions.length > 1 && serialized.length > MAX_REVISION_STORAGE_CHARS) {
    revisions.pop();
    serialized = JSON.stringify(revisions);
  }
  try {
    storage[storageKey(projectId, sceneId)] = serialized;
  } catch {
    // Revisions are best-effort; the scene itself is saved separately.
  }
  return revision;
}

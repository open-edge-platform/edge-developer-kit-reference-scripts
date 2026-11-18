// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { dataPath } from './storage';

type StopSceneSessions = (sceneId: string) => Promise<void>;
const cleanupKey = Symbol.for('mujoco-studio.scene-session-cleanup');
const registry = globalThis as typeof globalThis & {
  [cleanupKey]?: Map<string, StopSceneSessions>;
};

/** Worker managers register when loaded; Payload calls them before removing files. */
export function registerSceneSessionCleanup(kind: string, stop: StopSceneSessions): void {
  const callbacks = (registry[cleanupKey] ??= new Map());
  callbacks.set(kind, stop);
}

async function matchesScene(file: string, sceneId: string): Promise<boolean> {
  try {
    const metadata: unknown = JSON.parse(await readFile(file, 'utf8'));
    return (
      metadata !== null &&
      typeof metadata === 'object' &&
      'sceneId' in metadata &&
      metadata.sceneId === sceneId
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    // A malformed metadata file cannot establish ownership; leave it for manual recovery.
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}

async function directories(root: string): Promise<string[]> {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

/** Remove persisted Generate/Evaluate data owned by a deleted scene, including archive caches. */
export async function deleteSceneRuntimeData(sceneId: string): Promise<void> {
  for (const stop of registry[cleanupKey]?.values() ?? []) await stop(sceneId);

  const generateRoot = dataPath('teleoperation-sessions');
  const collectionsRoot = path.join(generateRoot, 'collections');
  for (const name of await directories(collectionsRoot)) {
    const directory = path.join(collectionsRoot, name);
    if (await matchesScene(path.join(directory, 'collection.json'), sceneId)) {
      await rm(directory, { recursive: true, force: true });
    }
  }

  const downloadsRoot = path.join(generateRoot, 'downloads');
  for (const name of await directories(generateRoot)) {
    if (name === 'collections' || name === 'downloads') continue;
    const directory = path.join(generateRoot, name);
    if (!(await matchesScene(path.join(directory, 'profile.json'), sceneId))) continue;
    const sessionId = `session-${name}`;
    try {
      for (const entry of await readdir(downloadsRoot, { withFileTypes: true })) {
        if (
          entry.isFile() &&
          (entry.name === `${sessionId}.zip` || entry.name.startsWith(`${sessionId}-`))
        ) {
          await rm(path.join(downloadsRoot, entry.name), { force: true });
        }
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    await rm(directory, { recursive: true, force: true });
  }

  const evaluationRoot = dataPath('evaluation-sessions');
  for (const name of await directories(evaluationRoot)) {
    const directory = path.join(evaluationRoot, name);
    if (await matchesScene(path.join(directory, 'profile.json'), sceneId)) {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

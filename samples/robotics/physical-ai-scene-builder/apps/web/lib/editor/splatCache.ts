// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  isFiniteVec3,
  normalizeSplatCalibration,
  type SplatCalibration,
  type Vec3Tuple,
} from './splatCollision';

/**
 * Caches a scene's splat file bytes and calibration in IndexedDB, so a refresh before the scene
 * is saved (which uploads the PLY) can restore it. Collision data is not cached: it is re-derived
 * from the reloaded point cloud with the cached calibration.
 */

const DB_NAME = 'edge-sim-splats';
const STORE_NAME = 'splats';
/** v1 held collision data; v2 added calibration; v3 scopes complete records to scene creation. */
const DB_VERSION = 3;
const RECORD_VERSION = 3;

export interface CachedSplat {
  file: Blob;
  /** SHA-256 hex of the file bytes. */
  hash: string;
  calibration: SplatCalibration;
  /**
   * Alignment origin of `calibration`.
   */
  origin: Vec3Tuple;
  createdAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      // Older records stay; `cachedSplatFromRecord` validates them on read.
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open the splat cache.'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = run(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Splat cache request failed.'));
    });
  } finally {
    db.close();
  }
}

/** Validates a stored unsaved-splat record for the matching scene creation. */
export function cachedSplatFromRecord(record: unknown, createdAt: string): CachedSplat | null {
  if (!record || typeof record !== 'object') return null;
  const candidate = record as Record<string, unknown>;
  if (typeof Blob === 'undefined' || !(candidate.file instanceof Blob)) return null;
  const current = candidate.version === RECORD_VERSION && candidate.createdAt === createdAt;
  if (!current || typeof candidate.hash !== 'string' || !isFiniteVec3(candidate.origin))
    return null;
  return {
    file: candidate.file,
    hash: candidate.hash,
    calibration: normalizeSplatCalibration(candidate.calibration),
    origin: candidate.origin,
    createdAt,
  };
}

/** True when this cache entry is only a refresh backup, not already persisted scene data. */
export function shouldCacheSplat(hash: string, savedHash: string | null | undefined): boolean {
  return !savedHash || hash !== savedHash;
}

/** Persists a scene's splat file and applied calibration. */
export async function saveCachedSplat(sceneId: number, splat: CachedSplat): Promise<void> {
  await withStore('readwrite', (store) =>
    store.put({ version: RECORD_VERSION, ...splat }, sceneId),
  );
}

/** Retrieves a previously cached splat for a scene, if any. */
export async function loadCachedSplat(
  sceneId: number,
  createdAt: string,
): Promise<CachedSplat | null> {
  const result = await withStore<unknown>('readonly', (store) => store.get(sceneId));
  return cachedSplatFromRecord(result, createdAt);
}

/** Removes a scene's cached splat (call when the user removes it). */
export async function deleteCachedSplat(sceneId: number): Promise<void> {
  await withStore('readwrite', (store) => store.delete(sceneId));
}

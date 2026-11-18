// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Cache bookkeeping for raw dataset archives: the inventory signature that names a cached archive,
 * and cleanup of archives and staging files that can no longer be served. Raw datasets reach
 * 100+ GB, so a stale copy left on disk is usually what makes the next build fail its free-space
 * check.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { unzipSync } from 'fflate';

/** Raw dataset format 2 stores each episode camera as an AV1 MP4 instead of raw pixel arrays. */
export const RAW_DATASET_FORMAT_VERSION = 2;
// Archives of every format version are recognized so older cached copies are cleaned up.
const RAW_DATASET_ARCHIVE_PATTERN = /^raw-dataset-v\d+-[0-9a-f]{64}\.zip$/;
const STAGED_ARCHIVE_PATTERN = /^(.+\.staged\.zip)(?:\.[0-9a-f-]+\.tmp)?$/;

/**
 * Files under the collection's `dataset/` directory that are not part of the archive. The Python
 * collection store rewrites them without changing any recording, so they must not affect the
 * signature either.
 */
export const RAW_DATASET_EXCLUDED_PATHS = ['generation_manifest.json'] as const;

export class RawDatasetCacheError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'RawDatasetCacheError';
  }
}

export function rawDatasetArchiveName(signature: string): string {
  return `raw-dataset-v${RAW_DATASET_FORMAT_VERSION}-${signature}.zip`;
}

/**
 * Digest of a `.mujoco-scene` bundle's contents. Every teleoperation session receives a freshly
 * zipped bundle whose entry timestamps differ even when nothing changed, so a byte digest would
 * invalidate the cached archive on every new session. Falls back to a byte digest when the file
 * is not a readable ZIP.
 */
export async function sceneBundleDigest(filePath: string): Promise<string> {
  const bytes = await readFile(/* turbopackIgnore: true */ filePath);
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  } catch {
    return `bytes:${createHash('sha256').update(bytes).digest('hex')}`;
  }
  const digest = createHash('sha256');
  for (const name of Object.keys(entries).sort()) {
    const content = entries[name];
    digest.update(`${name}\0${content.byteLength}\0`);
    digest.update(content);
  }
  return `zip:${digest.digest('hex')}`;
}

async function fileDigest(filePath: string): Promise<string> {
  const content = await readFile(/* turbopackIgnore: true */ filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Identifies everything that goes into a raw dataset archive: recordings under
 * `collectionDirectory` (by metadata) plus the session's profile and scene (by content).
 */
export async function rawDatasetInventorySignature({
  collectionDirectory,
  sessionDirectory,
  sourceFiles = {},
}: {
  collectionDirectory: string;
  sessionDirectory: string;
  sourceFiles?: Record<string, string>;
}): Promise<string> {
  const excluded = new Set(RAW_DATASET_EXCLUDED_PATHS.map((name) => `dataset/${name}`));
  const entries: string[] = [];
  const pending = [{ absolutePath: collectionDirectory, relativePath: '' }];
  while (pending.length) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of await readdir(current.absolutePath, { withFileTypes: true })) {
      const relativePath = current.relativePath
        ? `${current.relativePath}/${entry.name}`
        : entry.name;
      if (!current.relativePath && RAW_DATASET_ARCHIVE_PATTERN.test(entry.name)) continue;
      if (excluded.has(relativePath)) continue;
      const absolutePath = path.join(current.absolutePath, entry.name);
      if (entry.isSymbolicLink()) {
        throw new RawDatasetCacheError('Raw dataset contains an unsafe symbolic link.');
      }
      if (entry.isDirectory()) {
        pending.push({ absolutePath, relativePath });
        continue;
      }
      const info = await stat(/* turbopackIgnore: true */ absolutePath, { bigint: true });
      if (!info.isFile())
        throw new RawDatasetCacheError('Raw dataset contains a non-file artifact.');
      // Metadata only: hashing file contents here would re-read the whole collection (100+ GB
      // for large generated datasets) on every prepare/download check. The collection store
      // writes episodes into fresh temp directories and os.replace()s them, so any change to
      // a recording alters its inode, size, or nanosecond mtime/ctime.
      entries.push(
        `${relativePath}\0${info.size}\0${info.mtimeNs}\0${info.ctimeNs}\0${info.dev}\0${info.ino}`,
      );
    }
  }
  // Session files are rewritten for every new session, so only their contents count.
  const [profileDigest, sceneDigest] = await Promise.all([
    fileDigest(path.join(sessionDirectory, 'profile.json')),
    sceneBundleDigest(path.join(sessionDirectory, 'scene.mujoco-scene')),
  ]);
  entries.push(`profile.json\0${profileDigest}`, `scene.mujoco-scene\0${sceneDigest}`);
  const sourceDigest = createHash('sha256');
  for (const [archivePath, contents] of Object.entries(sourceFiles).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    sourceDigest.update(`${archivePath}\0${contents.length}\0${contents}`);
  }
  entries.push(`source-files\0${sourceDigest.digest('hex')}`);
  entries.sort();
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}

/** Removes cached raw dataset archives in `collectionDirectory` other than `keepName`. */
export async function pruneRawDatasetArchives(
  collectionDirectory: string,
  keepName: string,
): Promise<string[]> {
  const removed: string[] = [];
  for (const name of await readdir(collectionDirectory)) {
    if (name === keepName || !RAW_DATASET_ARCHIVE_PATTERN.test(name)) continue;
    await rm(path.join(collectionDirectory, name), { force: true });
    removed.push(name);
  }
  return removed;
}

/**
 * Removes staged raw dataset archives (and their `.tmp` files) left in `downloadsDirectory` by
 * builds that never finished, for example because the server was stopped mid-build. Staged paths
 * in `activeStagedPaths` belong to builds still running in this process and are kept.
 */
export async function removeOrphanedStagedArchives(
  downloadsDirectory: string,
  activeStagedPaths: ReadonlySet<string>,
): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(downloadsDirectory);
  } catch {
    return [];
  }
  const active = new Set([...activeStagedPaths].map((value) => path.resolve(value)));
  const removed: string[] = [];
  for (const name of names) {
    const match = STAGED_ARCHIVE_PATTERN.exec(name);
    if (!match || active.has(path.resolve(downloadsDirectory, match[1]))) continue;
    await rm(path.join(downloadsDirectory, name), { force: true });
    removed.push(name);
  }
  return removed;
}

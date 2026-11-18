// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Raw dataset downloads built from scene versions rather than a running session: an earlier
 * version on its own, or the current version merged with compatible earlier ones. Episodes are
 * renumbered in order (first version first) and each keeps a `sceneVersion` reference, so a
 * merged dataset records which scene version every episode was recorded in.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { createZipArchive, type ZipArchiveAdditionalFile } from '../archive/zipArchive';
import { readTrainingBundle } from '../generation/trainingBundle';
import {
  pruneRawDatasetArchives,
  RAW_DATASET_FORMAT_VERSION,
  rawDatasetArchiveName,
  RawDatasetCacheError,
  rawDatasetInventorySignature,
  removeOrphanedStagedArchives,
} from './rawDatasetCache';
import {
  mergeIssue,
  recordedEpisodes,
  resolveVersionSource,
  SceneVersionError,
  storedCollection,
  teleoperationStorageDirectory,
  type SceneVersionSource,
  type StoredCollection,
} from './sceneVersions';
import {
  integrationPath,
  readPythonProjectSources,
  teleoperationCollectionBusy,
  type TeleoperationRawDatasetPreparation,
} from './sessionManager';

interface VersionDatasetJob {
  status: Exclude<TeleoperationRawDatasetPreparation['status'], 'idle'>;
  phase: Exclude<TeleoperationRawDatasetPreparation['phase'], 'idle'>;
  processedBytes: number;
  totalBytes: number | null;
  download: { archivePath: string; filename: string; size: number } | null;
  error: string | null;
  signature: string | null;
  abortController: AbortController;
  cancelled: boolean;
  settled: Promise<void>;
}

const jobsKey = Symbol.for('mujoco-studio.teleoperation-version-datasets');
const stagedKey = Symbol.for('mujoco-studio.teleoperation-staged-raw-datasets');
const globals = globalThis as typeof globalThis & {
  [jobsKey]?: Map<string, VersionDatasetJob>;
  [stagedKey]?: Set<string>;
};
const jobs = (globals[jobsKey] ??= new Map<string, VersionDatasetJob>());
// Shared with sessionManager so neither deletes the other's in-progress staged archive.
const activeStaged = (globals[stagedKey] ??= new Set<string>());

interface ResolvedVersion {
  collection: StoredCollection;
  source: SceneVersionSource;
}

function safeFilename(value: string): string {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'scene'
  );
}

function jobKey(collectionIds: readonly string[]): string {
  return collectionIds.join(',');
}

export function parseVersionList(value: string | null): string[] {
  const ids = (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0) throw new SceneVersionError('Choose at least one scene version.', 400);
  if (new Set(ids).size !== ids.length) {
    throw new SceneVersionError('A scene version is listed twice.', 400);
  }
  return ids;
}

async function resolveVersions(collectionIds: readonly string[]): Promise<ResolvedVersion[]> {
  const resolved: ResolvedVersion[] = [];
  for (const collectionId of collectionIds) {
    const collection = await storedCollection(collectionId);
    const source = await resolveVersionSource(collection);
    if (!source) {
      throw new SceneVersionError(
        'The recording settings of a scene version are unknown, so it cannot be downloaded.',
        409,
      );
    }
    resolved.push({ collection, source });
  }
  const sceneIds = new Set(resolved.map((entry) => entry.collection.sceneId));
  if (sceneIds.size > 1) {
    throw new SceneVersionError('Only versions of the same scene can be merged.', 400);
  }
  const [primary, ...others] = resolved;
  for (const other of others) {
    const issue = mergeIssue(primary.source.profile, other.source.profile);
    if (issue) throw new SceneVersionError(`An earlier version cannot be merged: ${issue}`, 409);
  }
  return resolved;
}

async function signatureFor(versions: readonly ResolvedVersion[]): Promise<string> {
  const [trainingFiles, projectSources] = await Promise.all([
    readTrainingBundle(integrationPath()),
    readPythonProjectSources(path.join(integrationPath(), 'robotic_studio')),
  ]);
  const parts: string[] = [`versions:${versions.length}`];
  for (const { collection, source } of versions) {
    try {
      parts.push(
        await rawDatasetInventorySignature({
          collectionDirectory: collection.directory,
          sessionDirectory: path.dirname(source.profilePath),
          sourceFiles: { ...trainingFiles, ...projectSources },
        }),
      );
    } catch (error) {
      if (error instanceof RawDatasetCacheError) {
        throw new SceneVersionError(error.message, error.status);
      }
      throw error;
    }
  }
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [''];
  while (pending.length) {
    const relative = pending.pop() ?? '';
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) pending.push(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  return files;
}

function episodeDirectoryName(index: number): string {
  return `episode-${String(index).padStart(6, '0')}`;
}

async function isZip64Archive(archivePath: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const info = await stat(archivePath);
    if (!info.isFile() || info.size < 98) return false;
    handle = await open(archivePath, 'r');
    const tail = Buffer.alloc(98);
    await handle.read(tail, 0, 98, info.size - 98);
    return (
      tail.readUInt32LE(0) === 0x06064b50 &&
      tail.readUInt32LE(56) === 0x07064b50 &&
      tail.readUInt32LE(76) === 0x06054b50
    );
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function buildVersionDataset(
  collectionIds: readonly string[],
  job: VersionDatasetJob,
): Promise<{ archivePath: string; filename: string; size: number; signature: string }> {
  job.phase = 'checking-cache';
  for (const collectionId of collectionIds) {
    const busy = teleoperationCollectionBusy(collectionId);
    if (busy) throw new SceneVersionError(busy, 409);
  }
  const versions = await resolveVersions(collectionIds);
  const episodes = versions.flatMap(({ collection }) =>
    recordedEpisodes(collection.episodes)
      .sort((left, right) => left.episodeIndex - right.episodeIndex)
      .map((episode) => ({ collection, episode })),
  );
  if (episodes.length === 0) {
    throw new SceneVersionError(
      'Save at least one recorded episode before downloading the raw dataset.',
      409,
    );
  }
  const primary = versions[0];
  const merged = versions.length > 1;
  const filename = `${safeFilename(primary.source.profile.name)}-raw-dataset-${
    merged ? 'with-earlier-versions-' : ''
  }and-training-v${RAW_DATASET_FORMAT_VERSION}.zip`;
  const signatureBefore = await signatureFor(versions);
  const archiveName = rawDatasetArchiveName(signatureBefore);
  const archivePath = path.join(primary.collection.directory, archiveName);
  if (await isZip64Archive(archivePath)) {
    return {
      archivePath,
      filename,
      size: (await stat(archivePath)).size,
      signature: signatureBefore,
    };
  }

  job.phase = 'generating-training-environment';
  const [trainingFiles, projectSources, primaryMetadata] = await Promise.all([
    readTrainingBundle(integrationPath()),
    readPythonProjectSources(path.join(integrationPath(), 'robotic_studio')),
    readFile(path.join(primary.collection.directory, 'collection.json'), 'utf8').then(
      (text) => JSON.parse(text) as Record<string, unknown>,
    ),
  ]);
  const additionalFiles: ZipArchiveAdditionalFile[] = [
    { absolutePath: primary.source.profilePath, archivePath: 'profile.json' },
    { absolutePath: primary.source.scenePath, archivePath: 'scene.mujoco-scene' },
  ];
  const mergedEpisodes: Record<string, unknown>[] = [];
  for (const [index, { collection, episode }] of episodes.entries()) {
    const sourceDirectory = path.join(
      collection.directory,
      'dataset',
      'episodes',
      episodeDirectoryName(episode.episodeIndex),
    );
    const targetDirectory = `raw/episodes/${episodeDirectoryName(index)}`;
    for (const file of await listFiles(sourceDirectory)) {
      additionalFiles.push({
        absolutePath: path.join(sourceDirectory, file),
        archivePath: `${targetDirectory}/${file}`,
      });
    }
    mergedEpisodes.push({
      ...episode,
      episodeIndex: index,
      artifactPath: targetDirectory,
      sceneVersion: {
        collectionId: collection.collectionId,
        sceneFingerprint: collection.sceneFingerprint,
        episodeIndex: episode.episodeIndex,
      },
    });
  }
  const collectionMetadata = {
    ...primaryMetadata,
    nextEpisodeIndex: mergedEpisodes.length,
    episodes: mergedEpisodes,
    sceneVersions: versions.map(({ collection, source }) => ({
      collectionId: collection.collectionId,
      sceneFingerprint: collection.sceneFingerprint,
      name: source.profile.name,
      updatedAt: collection.updatedAt,
      episodes: mergedEpisodes.filter(
        (episode) =>
          (episode.sceneVersion as { collectionId: string }).collectionId ===
          collection.collectionId,
      ).length,
    })),
  };

  job.phase = 'archiving';
  const root = teleoperationStorageDirectory();
  const downloadsDirectory = path.join(root, 'downloads');
  await mkdir(downloadsDirectory, { recursive: true });
  const stagedPath = path.join(
    downloadsDirectory,
    `${primary.collection.collectionId}-${signatureBefore}-${randomUUID()}.staged.zip`,
  );
  await pruneRawDatasetArchives(primary.collection.directory, archiveName);
  await removeOrphanedStagedArchives(downloadsDirectory, activeStaged);
  activeStaged.add(stagedPath);
  try {
    const archive = await createZipArchive({
      sourceDirectory: path.join(primary.collection.directory, 'dataset'),
      archivePath: stagedPath,
      storageRoot: root,
      sourcePrefix: 'raw',
      // Episodes are added below under their merged numbers.
      excludePaths: ['generation_manifest.json', 'episodes', 'staging'],
      additionalFiles,
      rootFiles: {
        ...trainingFiles,
        ...projectSources,
        'collection.json': `${JSON.stringify(collectionMetadata, null, 2)}\n`,
        'raw-dataset.json': `${JSON.stringify(
          {
            format: 'robotic-studio-raw-dataset',
            version: RAW_DATASET_FORMAT_VERSION,
            collection: 'collection.json',
            profile: 'profile.json',
            scene: 'scene.mujoco-scene',
            episodes: 'raw/episodes',
          },
          null,
          2,
        )}\n`,
      },
      onProgress: ({ processedBytes, totalBytes }) => {
        job.processedBytes = processedBytes;
        job.totalBytes = totalBytes;
      },
      signal: job.abortController.signal,
    });
    if ((await signatureFor(versions)) !== signatureBefore) {
      throw new SceneVersionError(
        'The recording data changed while the raw dataset was being prepared. Retry the download.',
        409,
      );
    }
    await rename(stagedPath, archivePath);
    return { archivePath, filename, size: archive.size, signature: signatureBefore };
  } catch (error) {
    await rm(stagedPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    activeStaged.delete(stagedPath);
  }
}

function snapshot(job: VersionDatasetJob | undefined): TeleoperationRawDatasetPreparation {
  if (!job) {
    return {
      status: 'idle',
      phase: 'idle',
      processedBytes: 0,
      totalBytes: null,
      filename: null,
      size: null,
      error: null,
    };
  }
  return {
    status: job.status,
    phase: job.phase,
    processedBytes: job.processedBytes,
    totalBytes: job.totalBytes,
    filename: job.download?.filename ?? null,
    size: job.download?.size ?? null,
    error: job.error,
  };
}

async function jobIsCurrent(collectionIds: readonly string[], job: VersionDatasetJob) {
  if (!job.download || !job.signature) return false;
  try {
    return (await signatureFor(await resolveVersions(collectionIds))) === job.signature;
  } catch {
    return false;
  }
}

export function versionDatasetPreparation(
  collectionIds: readonly string[],
): TeleoperationRawDatasetPreparation {
  return snapshot(jobs.get(jobKey(collectionIds)));
}

export async function prepareVersionDataset(
  collectionIds: readonly string[],
): Promise<TeleoperationRawDatasetPreparation> {
  const key = jobKey(collectionIds);
  const existing = jobs.get(key);
  if (existing?.status === 'preparing') return snapshot(existing);
  if (existing?.status === 'ready' && (await jobIsCurrent(collectionIds, existing))) {
    return snapshot(existing);
  }
  // Fail fast on requests that can never succeed instead of reporting them through polling.
  await resolveVersions(collectionIds);
  const job: VersionDatasetJob = {
    status: 'preparing',
    phase: 'checking-cache',
    processedBytes: 0,
    totalBytes: null,
    download: null,
    error: null,
    signature: null,
    abortController: new AbortController(),
    cancelled: false,
    settled: Promise.resolve(),
  };
  job.settled = (async () => {
    try {
      const result = await buildVersionDataset(collectionIds, job);
      job.download = {
        archivePath: result.archivePath,
        filename: result.filename,
        size: result.size,
      };
      job.signature = result.signature;
      job.status = 'ready';
      job.phase = 'complete';
      job.processedBytes = result.size;
      job.totalBytes = result.size;
    } catch (error) {
      job.status = 'failed';
      job.phase = 'failed';
      job.error = job.cancelled
        ? 'The raw dataset preparation was cancelled.'
        : error instanceof Error
          ? error.message
          : String(error);
    }
  })();
  jobs.set(key, job);
  return snapshot(job);
}

export async function cancelVersionDataset(
  collectionIds: readonly string[],
): Promise<TeleoperationRawDatasetPreparation> {
  const key = jobKey(collectionIds);
  const job = jobs.get(key);
  if (job?.status === 'preparing') {
    job.cancelled = true;
    job.abortController.abort();
    await job.settled.catch(() => undefined);
    jobs.delete(key);
  }
  return snapshot(jobs.get(key));
}

export async function versionDatasetDownload(
  collectionIds: readonly string[],
): Promise<{ archivePath: string; filename: string; size: number }> {
  const job = jobs.get(jobKey(collectionIds));
  if (!job || job.status !== 'ready' || !job.download) {
    throw new SceneVersionError('Prepare the raw dataset before downloading the archive.', 409);
  }
  if (!(await jobIsCurrent(collectionIds, job))) {
    throw new SceneVersionError(
      'The recording data changed after the raw dataset was prepared. Prepare it again.',
      409,
    );
  }
  return job.download;
}

/** Forget prepared downloads that include a deleted version. */
export function forgetVersionDatasets(collectionId: string): void {
  for (const [key, job] of jobs) {
    if (!key.split(',').includes(collectionId)) continue;
    job.cancelled = true;
    job.abortController.abort();
    jobs.delete(key);
  }
}

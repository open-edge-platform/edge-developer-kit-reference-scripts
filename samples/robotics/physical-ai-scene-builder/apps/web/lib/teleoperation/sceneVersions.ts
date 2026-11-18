// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Scene versions for Generate data. A saved scene's generated scenes and recorded episodes live in
 * a collection directory keyed by the scene content (fingerprint) and capture profile, so editing
 * and saving the scene starts a new collection. This module lists those collections as "versions",
 * opens earlier ones read-only, and records what each version was built from so it can be reviewed,
 * downloaded, merged, or used to rebuild generated scenes after an edit.
 *
 * Layout inside a collection directory (besides the Python store's `collection.json`, `dataset/`):
 *   source/profile.json         profile of the latest session that used this version
 *   source/scene.mujoco-scene   scene bundle of that session
 *   source/carry-over.json      generated scenes rebuilt here from an earlier version (once)
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { dataPath } from '@mujoco-studio/payload/storage';
import {
  parseTeleoperationProfileV1,
  TELEOPERATION_DEFAULT_CAPTURE_FPS,
  TELEOPERATION_DEFAULT_STREAM_HZ,
  type TeleoperationCarryOverV1,
  type TeleoperationEpisodeSummaryV1,
  type TeleoperationProfileV1,
  type TeleoperationSceneVersionDetailV1,
  type TeleoperationSceneVersionV1,
  type TeleoperationStateSnapshotV1,
} from '@mujoco-studio/types';

import { teleoperationCaptureSignature } from './profile';
import { sceneBundleDigest } from './rawDatasetCache';

const COLLECTION_ID_PATTERN = /^collection-[A-Za-z0-9._-]+$/;
const BASE_STATE_ID = 'state-000000';
const SOURCE_DIRECTORY = 'source';

export class SceneVersionError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'SceneVersionError';
    this.status = status;
  }
}

export function teleoperationStorageDirectory(): string {
  return dataPath('teleoperation-sessions');
}

function collectionsDirectory(): string {
  return path.join(teleoperationStorageDirectory(), 'collections');
}

function safeFilename(value: string): string {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'scene'
  );
}

function teleoperationDataSignature(profile: TeleoperationProfileV1): string {
  const convention = profile.inputConvention;
  if (convention === 'so101-normalized') return convention;
  return JSON.stringify({ convention, state: profile.state, action: profile.action });
}

/** Collection (scene version) id for a scene fingerprint and capture profile. */
export function collectionIdFor(
  sceneId: string,
  sceneFingerprint: string,
  profile: TeleoperationProfileV1,
): string {
  const convention = profile.inputConvention;
  const captureSignature = teleoperationCaptureSignature(profile);
  const fingerprint = createHash('sha256')
    .update(
      convention === 'so101-normalized'
        ? `${sceneFingerprint}\n${captureSignature}`
        : `${sceneFingerprint}\n${captureSignature}\n${teleoperationDataSignature(profile)}`,
    )
    .digest('hex')
    .slice(0, 24);
  return `collection-${safeFilename(sceneId)}-${fingerprint}`;
}

export function collectionDirectoryFor(collectionId: string): string {
  if (!COLLECTION_ID_PATTERN.test(collectionId)) {
    throw new SceneVersionError('The scene version id is invalid.', 400);
  }
  return path.join(collectionsDirectory(), collectionId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(/* turbopackIgnore: true */ filePath, 'utf8'));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(/* turbopackIgnore: true */ filePath)).isFile();
  } catch {
    return false;
  }
}

/** Writes `contents` atomically when it differs from what is on disk. */
async function writeIfChanged(filePath: string, contents: string): Promise<void> {
  const existing = await readFile(/* turbopackIgnore: true */ filePath, 'utf8').catch(() => null);
  if (existing === contents) return;
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, contents, 'utf8');
  await rename(temporary, filePath);
}

// ------------------------------------------------------------------------------------------------
// Stored collections
// ------------------------------------------------------------------------------------------------

export interface StoredCollection {
  collectionId: string;
  directory: string;
  sceneId: string;
  sceneFingerprint: string;
  createdAt: string;
  updatedAt: string;
  states: TeleoperationStateSnapshotV1[];
  episodes: TeleoperationEpisodeSummaryV1[];
}

export async function readStoredCollection(directory: string): Promise<StoredCollection | null> {
  let value: unknown;
  try {
    value = await readJson(path.join(directory, 'collection.json'));
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    typeof value.collectionId !== 'string' ||
    typeof value.sceneId !== 'string' ||
    typeof value.sceneFingerprint !== 'string' ||
    !Array.isArray(value.states) ||
    !Array.isArray(value.episodes)
  ) {
    return null;
  }
  return {
    collectionId: value.collectionId,
    directory,
    sceneId: value.sceneId,
    sceneFingerprint: value.sceneFingerprint,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    states: value.states.filter(isRecord) as unknown as TeleoperationStateSnapshotV1[],
    episodes: value.episodes.filter(isRecord) as unknown as TeleoperationEpisodeSummaryV1[],
  };
}

export function generatedStates(collection: StoredCollection): TeleoperationStateSnapshotV1[] {
  return collection.states.filter((state) => state.stateId !== BASE_STATE_ID);
}

export function recordedEpisodes(
  episodes: readonly TeleoperationEpisodeSummaryV1[],
): TeleoperationEpisodeSummaryV1[] {
  return episodes.filter((episode) => episode.status === 'recorded' && episode.frameCount > 0);
}

/** Every collection of a saved scene, most recently changed first. */
export async function sceneCollections(sceneId: string): Promise<StoredCollection[]> {
  let names: string[];
  try {
    names = await readdir(collectionsDirectory());
  } catch {
    return [];
  }
  const collections: StoredCollection[] = [];
  for (const name of names) {
    if (!COLLECTION_ID_PATTERN.test(name)) continue;
    const collection = await readStoredCollection(path.join(collectionsDirectory(), name));
    if (collection && collection.sceneId === sceneId && collection.collectionId === name) {
      collections.push(collection);
    }
  }
  return collections.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

// ------------------------------------------------------------------------------------------------
// What a version was built from
// ------------------------------------------------------------------------------------------------

export interface SceneVersionSource {
  profile: TeleoperationProfileV1;
  profilePath: string;
  scenePath: string;
}

/**
 * Records the profile and scene bundle a session used for its collection, so the version can be
 * downloaded or merged after the session ends. Files are only rewritten when their content
 * changes, which keeps cached raw dataset archives valid.
 */
export async function recordCollectionSource(
  collectionDirectory: string,
  profile: TeleoperationProfileV1,
  sceneBundlePath: string,
): Promise<void> {
  const directory = path.join(collectionDirectory, SOURCE_DIRECTORY);
  await mkdir(directory, { recursive: true });
  await writeIfChanged(
    path.join(directory, 'profile.json'),
    `${JSON.stringify(profile, null, 2)}\n`,
  );
  const scenePath = path.join(directory, 'scene.mujoco-scene');
  const unchanged =
    (await fileExists(scenePath)) &&
    (await sceneBundleDigest(scenePath).catch(() => null)) ===
      (await sceneBundleDigest(sceneBundlePath));
  if (!unchanged) {
    const temporary = `${scenePath}.${process.pid}.tmp`;
    await copyFile(sceneBundlePath, temporary);
    await rename(temporary, scenePath);
  }
}

async function parsedProfile(filePath: string): Promise<TeleoperationProfileV1 | null> {
  try {
    return parseTeleoperationProfileV1(await readJson(filePath));
  } catch {
    return null;
  }
}

/** Profile and scene bundle a version was recorded with, or null when they are missing. */
export async function resolveVersionSource(
  collection: StoredCollection,
): Promise<SceneVersionSource | null> {
  const directory = path.join(collection.directory, SOURCE_DIRECTORY);
  const profilePath = path.join(directory, 'profile.json');
  const scenePath = path.join(directory, 'scene.mujoco-scene');
  const profile = await parsedProfile(profilePath);
  return profile && (await fileExists(scenePath)) ? { profile, profilePath, scenePath } : null;
}

export async function readCarryOver(
  collectionDirectory: string,
): Promise<TeleoperationCarryOverV1 | null> {
  try {
    const value = await readJson(
      path.join(collectionDirectory, SOURCE_DIRECTORY, 'carry-over.json'),
    );
    return isRecord(value) && typeof value.fromCollectionId === 'string'
      ? (value as unknown as TeleoperationCarryOverV1)
      : null;
  } catch {
    return null;
  }
}

export async function writeCarryOver(
  collectionDirectory: string,
  value: TeleoperationCarryOverV1,
): Promise<void> {
  const directory = path.join(collectionDirectory, SOURCE_DIRECTORY);
  await mkdir(directory, { recursive: true });
  await writeIfChanged(
    path.join(directory, 'carry-over.json'),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

/**
 * The earlier version whose generated scenes a new, empty version should rebuild: the most
 * recently changed other version of the same scene that has generated scenes.
 */
export async function carryOverSource(
  sceneId: string,
  collectionId: string,
): Promise<StoredCollection | null> {
  for (const collection of await sceneCollections(sceneId)) {
    if (collection.collectionId === collectionId) continue;
    if (generatedStates(collection).length > 0) return collection;
  }
  return null;
}

// ------------------------------------------------------------------------------------------------
// Merging
// ------------------------------------------------------------------------------------------------

function names(fields: readonly { name: string }[]): string {
  return fields.map((field) => field.name).join(',');
}

/**
 * Why episodes recorded with `other` cannot be merged into a dataset recorded with `primary`, or
 * null when they can: the converter needs the same state and action layout, control units, camera
 * names, and capture rate in every episode (camera resolution may differ; it is normalized).
 */
export function mergeIssue(
  primary: TeleoperationProfileV1,
  other: TeleoperationProfileV1,
): string | null {
  if (primary.inputConvention !== other.inputConvention) {
    return 'It uses different control units.';
  }
  if (names(primary.state) !== names(other.state)) return 'Its robot state fields differ.';
  if (names(primary.action) !== names(other.action)) return 'Its robot action fields differ.';
  const cameras = (profile: TeleoperationProfileV1) =>
    profile.cameras
      .map((camera) => camera.outputName)
      .sort()
      .join(',');
  if (primary.captureRgb !== other.captureRgb || cameras(primary) !== cameras(other)) {
    return 'It records different cameras.';
  }
  const fps = (profile: TeleoperationProfileV1) =>
    profile.captureFps ?? TELEOPERATION_DEFAULT_CAPTURE_FPS;
  if (fps(primary) !== fps(other)) return 'It records at a different frame rate.';
  return null;
}

// ------------------------------------------------------------------------------------------------
// Listing, reading, deleting
// ------------------------------------------------------------------------------------------------

async function versionSummary(
  collection: StoredCollection,
  current: { collectionId: string; profile: TeleoperationProfileV1 | null } | null,
): Promise<TeleoperationSceneVersionV1> {
  const source = await resolveVersionSource(collection);
  const isCurrent = current?.collectionId === collection.collectionId;
  let issue: string | null = null;
  if (current && !isCurrent) {
    issue =
      !current.profile || !source
        ? 'Its recording settings are unknown.'
        : mergeIssue(current.profile, source.profile);
  }
  return {
    collectionId: collection.collectionId,
    sceneId: collection.sceneId,
    sceneFingerprint: collection.sceneFingerprint,
    name: source?.profile.name ?? null,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
    generatedCount: generatedStates(collection).length,
    episodeCount: recordedEpisodes(collection.episodes).length,
    current: isCurrent,
    mergeable: Boolean(current) && !isCurrent && issue === null,
    mergeIssue: issue,
    carryOver: await readCarryOver(collection.directory),
  };
}

/**
 * Versions of a saved scene, most recently changed first. `currentCollectionId` is the version the
 * open Generate session uses; merge compatibility is reported against it.
 */
export async function listSceneVersions(
  sceneId: string,
  currentCollectionId?: string | null,
): Promise<TeleoperationSceneVersionV1[]> {
  const collections = await sceneCollections(sceneId);
  const currentCollection = currentCollectionId
    ? collections.find((collection) => collection.collectionId === currentCollectionId)
    : undefined;
  const current = currentCollection
    ? {
        collectionId: currentCollection.collectionId,
        profile: (await resolveVersionSource(currentCollection))?.profile ?? null,
      }
    : null;
  const versions: TeleoperationSceneVersionV1[] = [];
  for (const collection of collections) {
    versions.push(await versionSummary(collection, current));
  }
  return versions;
}

export async function storedCollection(collectionId: string): Promise<StoredCollection> {
  const collection = await readStoredCollection(collectionDirectoryFor(collectionId));
  if (!collection || collection.collectionId !== collectionId) {
    throw new SceneVersionError('That scene version was not found.', 404);
  }
  return collection;
}

export async function sceneVersionDetail(
  collectionId: string,
): Promise<TeleoperationSceneVersionDetailV1> {
  const collection = await storedCollection(collectionId);
  const source = await resolveVersionSource(collection);
  return {
    version: await versionSummary(collection, null),
    states: collection.states,
    episodes: collection.episodes,
    streamHz: source?.profile.streamHz ?? TELEOPERATION_DEFAULT_STREAM_HZ,
  };
}

export function versionEpisode(
  collection: StoredCollection,
  episodeId: string,
): TeleoperationEpisodeSummaryV1 {
  const episode = collection.episodes.find((candidate) => candidate.episodeId === episodeId);
  if (!episode) throw new SceneVersionError('Episode not found.', 404);
  return episode;
}

/** Deletes an earlier version's generated scenes, episodes, and cached downloads. */
export async function deleteSceneVersion(
  collectionId: string,
  inUse: (collectionId: string) => boolean,
): Promise<void> {
  const collection = await storedCollection(collectionId);
  if (inUse(collectionId)) {
    throw new SceneVersionError(
      'This version is open in Generate. Only earlier versions can be deleted.',
      409,
    );
  }
  await rm(collection.directory, { recursive: true, force: true });
}

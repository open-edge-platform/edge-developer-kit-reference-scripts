// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { dataPath } from '@mujoco-studio/payload/storage';
import { registerSceneSessionCleanup } from '@mujoco-studio/payload/scene-runtime-cleanup';
import {
  type ModelRandomizationRuleV1,
  parseTeleoperationProfileV1,
  type TeleoperationCommandKindV1,
  type TeleoperationBatchStatusV1,
  type TeleoperationCarryOverV1,
  type TeleoperationEndpointsV1,
  type TeleoperationEpisodeSummaryV1,
  type TeleoperationPendingRecordingV1,
  type TeleoperationProfileV1,
  type TeleoperationRobotRandomizationV1,
  type TeleoperationSessionStatus,
  type TeleoperationSourceRandomizationV1,
  type TeleoperationStateSnapshotV1,
} from '@mujoco-studio/types';
import { Dealer } from 'zeromq';
import { NativeCommandRelay, nativeRelayEndpoints } from '../process/nativeRelay';

import {
  installShutdownHandler,
  pythonWorkerEnvironment,
  recoverMarkedWorkerProcesses,
  reserveWorkerStart,
  resolvePythonRunner,
  serializeWorkerOperation,
  waitForExitOrForceKill,
} from '../process/pythonWorkerProcess';
import { createZipArchive, type ZipArchiveAdditionalFile } from '../archive/zipArchive';
import { readTrainingBundle } from '../generation/trainingBundle';
import { readControlBundle, readPythonProjectSources } from './controlBundle';
import {
  getTeleoperationEpisode,
  getTeleoperationVideo,
  TeleoperationReviewError,
  type TeleoperationVideoFile,
} from './reviewStore';
import {
  carryOverSource,
  collectionDirectoryFor,
  collectionIdFor,
  generatedStates,
  readCarryOver,
  recordCollectionSource,
  writeCarryOver,
} from './sceneVersions';
import type { TeleoperationBatchStartOptions } from './batchRequest';
import {
  readBackdropRenderProgress,
  type TeleoperationBackdropRenderProgress,
} from './backdropRender';
import {
  pruneRawDatasetArchives,
  rawDatasetArchiveName,
  RawDatasetCacheError,
  RAW_DATASET_EXCLUDED_PATHS,
  RAW_DATASET_FORMAT_VERSION,
  rawDatasetInventorySignature as inventorySignature,
  removeOrphanedStagedArchives,
} from './rawDatasetCache';
import { integrationPath } from '@/lib/process/integrationPaths';

export { integrationPath };

export const MAX_TELEOPERATION_SCENE_BUNDLE_BYTES = 1024 ** 3;
const READY_TIMEOUT_MS = 15_000;
// A cold XPU kernel cache (first backdrop render) can take over a minute to compile.
const STARTUP_TIMEOUT_MS = 180_000;
const STOP_TIMEOUT_MS = 3_000;
const MAX_LOG_LINES = 200;
const MAX_LOG_LINE_CHARACTERS = 16_384;
const DEFAULT_TELEOPERATION_BASE_PORT = 8080;

export interface CreateTeleoperationSessionInput {
  sceneBundlePath: string;
  sceneBundleName?: string;
  profile: unknown;
}

/** A stopped recording, with how many of its backdrop frames still render at save. */
export type TeleoperationPendingRecording = TeleoperationPendingRecordingV1 &
  TeleoperationBackdropRenderProgress;

export interface TeleoperationSessionSummary extends TeleoperationBackdropRenderProgress {
  protocolVersion: 1;
  sessionId: string;
  collectionId: string;
  sceneId: string;
  sceneFingerprint: string;
  status: TeleoperationSessionStatus;
  endpoints: TeleoperationEndpointsV1;
  profile: TeleoperationProfileV1;
  activeStateId: string;
  stateRevision: number;
  recording: 'idle' | 'recording' | 'stopping';
  pendingRecording: TeleoperationPendingRecording | null;
  activeEpisodeId?: string;
  episodeCount: number;
  streamHz: number;
  streamSequence: number;
  states: TeleoperationStateSnapshotV1[];
  episodes: TeleoperationEpisodeSummaryV1[];
  pid: number | null;
  error?: string;
  batch?: TeleoperationBatchStatusV1;
  /** An external app (SDK client, evaluator, virtual follower) holds the control lease. */
  controlled?: boolean;
  /** Generated scenes rebuilt in this scene version from an earlier one, if any. */
  carryOver?: TeleoperationCarryOverV1 | null;
  evaluationProfile?: Record<string, unknown>;
}

export interface TeleoperationDownload {
  archivePath: string;
  filename: string;
  size: number;
}

export type TeleoperationRawDatasetPreparationPhase =
  | 'idle'
  | 'checking-cache'
  | 'generating-training-environment'
  | 'archiving'
  | 'complete'
  | 'failed';

export interface TeleoperationRawDatasetPreparation {
  status: 'idle' | 'preparing' | 'ready' | 'failed';
  phase: TeleoperationRawDatasetPreparationPhase;
  processedBytes: number;
  totalBytes: number | null;
  filename: string | null;
  size: number | null;
  error: string | null;
}

export interface TeleoperationSceneBundle {
  scenePath: string;
  filename: string;
  size: number;
}

export class TeleoperationSessionError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'TeleoperationSessionError';
    this.status = status;
  }
}

interface ReadyMessage {
  event: 'ready';
  sessionId: string;
  collectionId: string;
  endpoints: TeleoperationEndpointsV1;
  pid: number;
}

interface TeleoperationRecord {
  relay?: NativeCommandRelay;
  evaluationRelay?: NativeCommandRelay;
  summary: TeleoperationSessionSummary;
  directory: string;
  collectionDirectory: string;
  process: ChildProcess;
  dealer: Dealer;
  commandSequence: number;
  commandChain: Promise<unknown>;
  logs: string[];
  stdoutBuffer: string;
  closed: Promise<void>;
  resolveClosed: () => void;
  rawDatasetJob: RawDatasetJob | null;
}

interface RawDatasetJob {
  status: Exclude<TeleoperationRawDatasetPreparation['status'], 'idle'>;
  phase: Exclude<TeleoperationRawDatasetPreparationPhase, 'idle'>;
  processedBytes: number;
  totalBytes: number | null;
  download: TeleoperationDownload | null;
  error: string | null;
  inventorySignature: string | null;
  abortController: AbortController;
  cancelled: boolean;
  settled: Promise<void>;
}

interface TeleoperationManagerState {
  sessions: Map<string, TeleoperationRecord>;
  activeSessionId: string | null;
  starting: boolean;
  operationChain: Promise<void>;
  shutdownPromise: Promise<void> | null;
  installed: boolean;
}

const managerStateKey = Symbol.for('mujoco-studio.teleoperation-manager');
const managerGlobal = globalThis as typeof globalThis & {
  [managerStateKey]?: TeleoperationManagerState;
};

function storageDirectory(): string {
  return dataPath('teleoperation-sessions');
}

function teleoperationBasePort(): number {
  const configured = process.env.ROBOTIC_STUDIO_TELEOPERATION_BASE_PORT?.trim();
  if (!configured) return DEFAULT_TELEOPERATION_BASE_PORT;
  const value = Number(configured);
  if (!Number.isInteger(value) || value < 1 || value > 65_533) {
    throw new TeleoperationSessionError(
      'ROBOTIC_STUDIO_TELEOPERATION_BASE_PORT must be an integer between 1 and 65533.',
      500,
    );
  }
  return value;
}

function safeFilename(value: string): string {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'scene'
  );
}

export { CONTROL_EXAMPLE_FILES, readPythonProjectSources } from './controlBundle';

function boundedText(value: string): string {
  return value.length <= MAX_LOG_LINE_CHARACTERS
    ? value
    : `${value.slice(0, MAX_LOG_LINE_CHARACTERS - 3)}...`;
}

function appendLog(record: TeleoperationRecord, value: string): void {
  if (!value.trim()) return;
  record.logs.push(boundedText(value));
  if (record.logs.length > MAX_LOG_LINES) record.logs.splice(0, record.logs.length - MAX_LOG_LINES);
}

function cloneSummary(summary: TeleoperationSessionSummary): TeleoperationSessionSummary {
  return {
    ...summary,
    endpoints: { ...summary.endpoints },
    profile: {
      ...summary.profile,
      state: [...summary.profile.state],
      action: [...summary.profile.action],
      cameras: [...summary.profile.cameras],
      sourceRandomization: summary.profile.sourceRandomization
        ? structuredClone(summary.profile.sourceRandomization)
        : undefined,
      modelRandomization: summary.profile.modelRandomization
        ? summary.profile.modelRandomization.map((rule) => structuredClone(rule))
        : undefined,
    },
    pendingRecording: summary.pendingRecording ? { ...summary.pendingRecording } : null,
    states: summary.states.map((state) => ({
      ...state,
      qpos: [...state.qpos],
      qvel: [...state.qvel],
      ctrl: [...state.ctrl],
      sourceRandomization: state.sourceRandomization ? { ...state.sourceRandomization } : undefined,
      ...(state.objectRandomization
        ? {
            objectRandomization: state.objectRandomization.map((sample) => ({
              ...sample,
              values: [...sample.values],
            })),
          }
        : {}),
      modelRandomization: state.modelRandomization?.map((sample) => ({
        ...sample,
        values: [...sample.values],
      })),
      modelOverrides: state.modelOverrides?.map((override) => ({
        ...override,
        values: [...override.values],
      })),
    })),
    episodes: (summary.episodes ?? []).map((episode) => ({ ...episode })),
  };
}

function recordedEpisodes(record: TeleoperationRecord): TeleoperationEpisodeSummaryV1[] {
  return record.summary.episodes.filter(
    (episode) => episode.status === 'recorded' && episode.frameCount > 0,
  );
}

async function isZip64Archive(archivePath: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const info = await stat(archivePath);
    if (!info.isFile() || info.size < 98) return false;
    handle = await open(archivePath, 'r');
    const tail = Buffer.alloc(98);
    const result = await handle.read(tail, 0, tail.byteLength, info.size - tail.byteLength);
    if (result.bytesRead !== tail.byteLength) return false;
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

async function rawCollectionMetadata(record: TeleoperationRecord): Promise<string> {
  let value: unknown;
  try {
    value = JSON.parse(
      await readFile(path.join(record.collectionDirectory, 'collection.json'), 'utf8'),
    );
  } catch (error) {
    throw new TeleoperationSessionError(
      `The raw collection metadata could not be read: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
  if (!isRecord(value) || !Array.isArray(value.episodes)) {
    throw new TeleoperationSessionError('The raw collection metadata is invalid.', 500);
  }
  const episodes = value.episodes.map((episode) => {
    if (!isRecord(episode) || typeof episode.episodeIndex !== 'number') return episode;
    const episodeIndex = episode.episodeIndex;
    if (!Number.isSafeInteger(episodeIndex) || episodeIndex < 0) return episode;
    return {
      ...episode,
      artifactPath: `raw/episodes/episode-${String(episodeIndex).padStart(6, '0')}`,
    };
  });
  return `${JSON.stringify({ ...value, episodes }, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readyMessage(value: unknown): ReadyMessage | null {
  if (!isRecord(value) || value.event !== 'ready') return null;
  const endpoints = value.endpoints;
  if (
    typeof value.sessionId !== 'string' ||
    typeof value.collectionId !== 'string' ||
    typeof value.pid !== 'number' ||
    !isRecord(endpoints) ||
    typeof endpoints.control !== 'string' ||
    typeof endpoints.publisher !== 'string' ||
    typeof endpoints.stream !== 'string'
  ) {
    return null;
  }
  return {
    event: 'ready',
    sessionId: value.sessionId,
    collectionId: value.collectionId,
    endpoints: {
      control: endpoints.control,
      publisher: endpoints.publisher,
      stream: endpoints.stream,
    },
    pid: value.pid,
  };
}

async function waitForReady(
  child: ChildProcess,
  record: TeleoperationRecord,
): Promise<ReadyMessage> {
  return new Promise<ReadyMessage>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timer = null;
      if (settled) return;
      settled = true;
      reject(
        new TeleoperationSessionError(
          'The native teleoperation process did not become ready.',
          504,
        ),
      );
    }, STARTUP_TIMEOUT_MS);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      timer = null;
      callback();
    };
    const consume = (chunk: Uint8Array | string, flush = false) => {
      record.stdoutBuffer +=
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      const lines = record.stdoutBuffer.split(/\r?\n/);
      record.stdoutBuffer = flush ? '' : lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        appendLog(record, line);
        try {
          const ready = readyMessage(JSON.parse(line));
          if (ready) finish(() => resolve(ready));
        } catch {
          // Native startup logs may be non-JSON; retain them for diagnostics.
        }
      }
    };
    child.stdout?.on('data', consume);
    child.stderr?.on('data', (chunk: Uint8Array | string) => {
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      for (const line of text.split(/\r?\n/)) appendLog(record, line);
    });
    child.once('error', (error) =>
      finish(() => reject(new TeleoperationSessionError(error.message, 500))),
    );
    child.once('close', (code, signal) => {
      record.relay?.close();
      consume('', true);
      finish(() =>
        reject(
          new TeleoperationSessionError(
            `The native teleoperation process exited before readiness (${signal || code || 'unknown'}).`,
            500,
          ),
        ),
      );
    });
  });
}

function startSummary(
  profile: TeleoperationProfileV1,
  ready: ReadyMessage,
  pid: number | null,
): TeleoperationSessionSummary {
  return {
    protocolVersion: 1,
    sessionId: ready.sessionId,
    collectionId: ready.collectionId,
    sceneId: profile.sceneId,
    sceneFingerprint: profile.sceneFingerprint,
    status: 'ready',
    endpoints: ready.endpoints,
    profile,
    activeStateId: 'state-000000',
    stateRevision: 0,
    recording: 'idle',
    pendingRecording: null,
    episodeCount: 0,
    streamHz: profile.streamHz,
    streamSequence: 0,
    states: [],
    episodes: [],
    pid,
  };
}

function parseResponse(
  raw: Buffer,
  requestId: number,
): { result?: Record<string, unknown>; error?: Record<string, unknown> } {
  let value: unknown;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new TeleoperationSessionError(
      'The native teleoperation response was not valid JSON.',
      502,
    );
  }
  if (!isRecord(value) || value.requestId !== requestId) {
    throw new TeleoperationSessionError(
      'The native teleoperation response did not match the request.',
      502,
    );
  }
  if (value.ok !== true) {
    const error = isRecord(value.error) ? value.error : {};
    throw new TeleoperationSessionError(
      typeof error.message === 'string'
        ? error.message
        : 'The native teleoperation command failed.',
      errorStatus(typeof error.code === 'string' ? error.code : ''),
    );
  }
  if (!isRecord(value.result)) {
    throw new TeleoperationSessionError(
      'The native teleoperation response is missing its result.',
      502,
    );
  }
  return { result: value.result };
}

function responseRequestId(raw: Buffer): number | null {
  try {
    const value = JSON.parse(raw.toString('utf8')) as unknown;
    return isRecord(value) && typeof value.requestId === 'number' ? value.requestId : null;
  } catch {
    return null;
  }
}

function errorStatus(code: string): number {
  if (code === 'STATE_REVISION_STALE' || code === 'STATE_CHANGE_DURING_RECORDING') return 409;
  if (code === 'STATE_DELETE_FORBIDDEN') return 409;
  if (code === 'STATE_NOT_FOUND') return 404;
  if (code === 'LEASE_REQUIRED' || code === 'LEASE_INVALID') return 409;
  if (code === 'SESSION_MISMATCH' || code === 'SCENE_CHANGED') return 409;
  if (code === 'RECORDING_NOT_ACTIVE' || code === 'RECORDING_ALREADY_ACTIVE') return 409;
  if (code === 'SESSION_STOPPING') return 409;
  if (code === 'BATCH_ACTIVE' || code === 'SAVE_IN_PROGRESS' || code === 'COLLECTION_LOCKED') {
    return 409;
  }
  return 400;
}

async function exchange(
  record: TeleoperationRecord,
  command: TeleoperationCommandKindV1 | 'evaluation.configure' | 'stream.stop',
  fields: Record<string, unknown> = {},
  options: { receiveTimeout?: number } = {},
): Promise<Record<string, unknown>> {
  const requestId = ++record.commandSequence;
  const envelope = {
    protocolVersion: 1,
    sessionId: record.summary.sessionId,
    clientId: 'node-admin',
    requestId,
    command,
    ...fields,
  };
  const previousReceiveTimeout = record.dealer.receiveTimeout;
  if (options.receiveTimeout !== undefined) {
    record.dealer.receiveTimeout = options.receiveTimeout;
  }
  try {
    await record.dealer.send(JSON.stringify(envelope));
    for (;;) {
      const [response] = await record.dealer.receive();
      if (!response)
        throw new TeleoperationSessionError('The native teleoperation response was empty.', 502);
      const receivedRequestId = responseRequestId(response);
      if (receivedRequestId !== null && receivedRequestId < requestId) {
        continue;
      }
      const parsed = parseResponse(response, requestId);
      return parsed.result ?? {};
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EAGAIN') {
      throw new TeleoperationSessionError(
        `The native teleoperation '${command}' command timed out.`,
        504,
      );
    }
    throw error;
  } finally {
    record.dealer.receiveTimeout = previousReceiveTimeout;
  }
}

function queuedExchange(
  record: TeleoperationRecord,
  command: TeleoperationCommandKindV1 | 'evaluation.configure' | 'stream.stop',
  fields: Record<string, unknown> = {},
  options: { receiveTimeout?: number } = {},
): Promise<Record<string, unknown>> {
  const next = record.commandChain.then(() => exchange(record, command, fields, options));
  record.commandChain = next.catch(() => undefined);
  return next;
}

function pendingRecordingFrom(value: unknown): TeleoperationPendingRecording | null {
  return isRecord(value)
    ? {
        ...(value as unknown as TeleoperationPendingRecordingV1),
        ...readBackdropRenderProgress(value),
      }
    : null;
}

function updateBackdropProgress(record: TeleoperationRecord, value: unknown): void {
  const progress = readBackdropRenderProgress(value);
  if (progress.backdropRenderStatus !== undefined) {
    record.summary.backdropRenderStatus = progress.backdropRenderStatus;
  }
  if (progress.backdropDeferredFrames !== undefined) {
    record.summary.backdropDeferredFrames = progress.backdropDeferredFrames;
  }
}

/** A saved or discarded recording leaves nothing deferred. */
function clearBackdropProgress(record: TeleoperationRecord): void {
  record.summary.backdropDeferredFrames = 0;
  if (record.summary.backdropRenderStatus !== undefined) {
    record.summary.backdropRenderStatus =
      record.summary.backdropRenderStatus === 'inactive' ? 'inactive' : 'live';
  }
}

function updateFromDescription(record: TeleoperationRecord, value: Record<string, unknown>): void {
  if (isRecord(value.evaluationProfile)) record.summary.evaluationProfile = value.evaluationProfile;
  if (isRecord(value.batch)) {
    record.summary.batch = value.batch as unknown as TeleoperationBatchStatusV1;
  }
  if (typeof value.controlled === 'boolean') record.summary.controlled = value.controlled;
  if (typeof value.activeStateId === 'string') record.summary.activeStateId = value.activeStateId;
  if (typeof value.stateRevision === 'number') record.summary.stateRevision = value.stateRevision;
  if (typeof value.recording === 'boolean')
    record.summary.recording = value.recording ? 'recording' : 'idle';
  if ('pendingRecording' in value) {
    record.summary.pendingRecording = pendingRecordingFrom(value.pendingRecording);
  }
  updateBackdropProgress(record, value);
  if (typeof value.episodeCount === 'number') record.summary.episodeCount = value.episodeCount;
  const collection = value.collection;
  if (isRecord(collection)) {
    if (Array.isArray(collection.episodes))
      record.summary.episodeCount = collection.episodes.length;
    if (Array.isArray(collection.states)) {
      record.summary.states = collection.states as unknown as TeleoperationStateSnapshotV1[];
    }
    if (Array.isArray(collection.episodes)) {
      record.summary.episodes = collection.episodes as unknown as TeleoperationEpisodeSummaryV1[];
    }
  }
}

async function describe(record: TeleoperationRecord): Promise<Record<string, unknown>> {
  const result = await queuedExchange(record, 'describe');
  updateFromDescription(record, result);
  return result;
}

async function signalNativeProcess(
  record: TeleoperationRecord,
  signal: NodeJS.Signals,
): Promise<void> {
  const pid = record.summary.pid;
  if (!pid || pid === record.process.pid) return;
  const commandLine = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '');
  if (
    !commandLine.includes('robotic_studio.teleoperation.cli') ||
    !commandLine.includes(record.summary.sessionId)
  )
    return;
  try {
    process.kill(pid, signal);
  } catch {
    // The native process may have exited between inspection and signaling.
  }
}

async function closeProcess(record: TeleoperationRecord): Promise<void> {
  await signalNativeProcess(record, 'SIGTERM');
  if (record.process.exitCode !== null) return;
  record.process.stdin?.end();
  try {
    record.process.kill('SIGTERM');
  } catch {
    return;
  }
  await waitForExitOrForceKill(record.process, {
    timeoutMs: STOP_TIMEOUT_MS,
    exited: record.closed,
    onTimeout: () => {
      signalNativeProcess(record, 'SIGKILL');
    },
  });
}

async function removeProcessMarker(record: TeleoperationRecord): Promise<void> {
  await unlink(path.join(record.directory, 'process.json')).catch(() => undefined);
}

function installProcessCleanup(): void {
  installShutdownHandler(managerState, cleanupTeleoperationSessions);
}

const managerState =
  managerGlobal[managerStateKey] ??
  (managerGlobal[managerStateKey] = {
    sessions: new Map<string, TeleoperationRecord>(),
    activeSessionId: null,
    starting: false,
    operationChain: Promise.resolve(),
    shutdownPromise: null,
    installed: false,
  });
installProcessCleanup();

type SessionReadyListener = (session: TeleoperationSessionSummary) => Promise<void>;
type SessionEndListener = (sessionId: string) => Promise<void>;
const lifecycleKey = Symbol.for('mujoco-studio.shared-stream-lifecycle');
type SessionLifecycle = {
  ready: Map<string, SessionReadyListener>;
  ended: Map<string, SessionEndListener>;
  streamStopped?: Map<string, SessionEndListener>;
};
const lifecycleGlobal = globalThis as typeof globalThis & {
  [lifecycleKey]?: SessionLifecycle;
};
const lifecycle: SessionLifecycle = (lifecycleGlobal[lifecycleKey] ??= {
  ready: new Map(),
  ended: new Map(),
});
const sessionReadyListeners = lifecycle.ready;
const sessionEndListeners = lifecycle.ended;
const streamStoppedListeners = (lifecycle.streamStopped ??= new Map());

export function onTeleoperationSessionReady(name: string, listener: SessionReadyListener): void {
  sessionReadyListeners.set(name, listener);
}

export function onTeleoperationSessionEnded(name: string, listener: SessionEndListener): void {
  sessionEndListeners.set(name, listener);
}

/** Runs when a client stops the shared stream; the session and its worker stay up. */
export function onTeleoperationStreamStopped(name: string, listener: SessionEndListener): void {
  streamStoppedListeners.set(name, listener);
}

// Staged raw dataset archives still being written by this process; everything else in
// `downloads/` with a staged name is left over from an interrupted build.
const stagedRawDatasetsKey = Symbol.for('mujoco-studio.teleoperation-staged-raw-datasets');
const stagedRawDatasetsGlobal = globalThis as typeof globalThis & {
  [stagedRawDatasetsKey]?: Set<string>;
};
const activeStagedRawDatasets = (stagedRawDatasetsGlobal[stagedRawDatasetsKey] ??=
  new Set<string>());

async function sessionDirectory(): Promise<{ id: string; directory: string }> {
  const root = storageDirectory();
  await mkdir(root, { recursive: true });
  for (;;) {
    const id = randomUUID();
    const directory = path.join(root, id);
    try {
      await mkdir(directory);
      return { id, directory };
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
  }
}

async function sceneCollectionDirectory(
  sceneId: string,
  sceneFingerprint: string,
  profile: TeleoperationProfileV1,
): Promise<{ id: string; directory: string }> {
  const id = collectionIdFor(sceneId, sceneFingerprint, profile);
  const directory = collectionDirectoryFor(id);
  await mkdir(directory, { recursive: true });
  return { id, directory };
}

async function validateSceneBundle(input: CreateTeleoperationSessionInput): Promise<void> {
  const name = input.sceneBundleName?.trim() || path.basename(input.sceneBundlePath);
  if (!name.toLowerCase().endsWith('.mujoco-scene')) {
    throw new TeleoperationSessionError('Scene bundle must use the .mujoco-scene extension.', 400);
  }
  let bundle;
  try {
    bundle = await stat(input.sceneBundlePath);
  } catch {
    throw new TeleoperationSessionError('Scene bundle could not be read.', 400);
  }
  if (!bundle.isFile())
    throw new TeleoperationSessionError('Scene bundle must be a regular file.', 400);
  if (bundle.size > MAX_TELEOPERATION_SCENE_BUNDLE_BYTES) {
    throw new TeleoperationSessionError(
      `Scene bundle exceeds the ${Math.round(MAX_TELEOPERATION_SCENE_BUNDLE_BYTES / 1024 ** 2)} MB limit.`,
      413,
    );
  }
}

export async function relayTeleoperationCommand(
  sessionId: string,
  request: Request,
): Promise<Response> {
  const record = managerState.sessions.get(sessionId);
  if (!record || !['ready', 'active'].includes(record.summary.status)) {
    return Response.json({ error: 'Teleoperation session not found.' }, { status: 404 });
  }
  if (!record.relay) {
    record.relay = new NativeCommandRelay(record.summary.endpoints.control, 'teleoperation');
  }
  return record.relay.respond(request);
}

export async function relaySharedEvaluationCommand(
  sessionId: string,
  request: Request,
): Promise<Response> {
  const record = managerState.sessions.get(sessionId);
  if (!record || !['ready', 'active'].includes(record.summary.status)) {
    return Response.json({ error: 'Shared streaming session not found.' }, { status: 404 });
  }
  if (!record.evaluationRelay) {
    record.evaluationRelay = new NativeCommandRelay(record.summary.endpoints.control, 'evaluation');
  }
  return record.evaluationRelay.respond(request);
}

export async function configureTeleoperationEvaluation(
  sessionId: string,
  profile: Record<string, unknown>,
): Promise<TeleoperationSessionSummary> {
  const record = managerState.sessions.get(sessionId);
  if (!record) throw new TeleoperationSessionError('Shared streaming session not found.', 404);
  const result = await queuedExchange(record, 'evaluation.configure', {
    profile: {
      ...(profile.task ? { task: profile.task } : {}),
      randomization: profile.randomization ?? [],
      actionRangePolicy: profile.actionRangePolicy ?? 'clip',
    },
  });
  if (!isRecord(result.profile))
    throw new TeleoperationSessionError('Invalid evaluation profile.', 502);
  record.summary.evaluationProfile = result.profile;
  return cloneSummary(record.summary);
}

export async function stopTeleoperationStream(
  sessionId: string,
): Promise<TeleoperationSessionSummary> {
  const record = managerState.sessions.get(sessionId);
  if (!record) throw new TeleoperationSessionError('Shared streaming session not found.', 404);
  for (const listener of streamStoppedListeners.values()) {
    await listener(sessionId).catch((error: unknown) =>
      console.error('Shared stream stop listener failed.', error),
    );
  }
  await queuedExchange(record, 'stream.stop');
  await describe(record);
  return cloneSummary(record.summary);
}

export function relayTeleoperationPublisher(sessionId: string, request: Request): Response {
  const record = managerState.sessions.get(sessionId);
  if (!record || !['ready', 'active'].includes(record.summary.status)) {
    return Response.json({ error: 'Teleoperation session not found.' }, { status: 404 });
  }
  if (!record.relay) {
    record.relay = new NativeCommandRelay(record.summary.endpoints.control, 'teleoperation');
  }
  return record.relay.publisher(request, record.summary.endpoints.publisher, sessionId);
}

export async function startTeleoperationSession(
  input: CreateTeleoperationSessionInput,
): Promise<TeleoperationSessionSummary> {
  return reserveWorkerStart(
    managerState,
    () => new TeleoperationSessionError('A teleoperation session is already starting.', 409),
    () => startTeleoperationSessionExclusive(input),
  );
}

async function startTeleoperationSessionExclusive(
  input: CreateTeleoperationSessionInput,
): Promise<TeleoperationSessionSummary> {
  if (managerState.activeSessionId) {
    const active = managerState.sessions.get(managerState.activeSessionId);
    if (active && ['starting', 'ready', 'active', 'stopping'].includes(active.summary.status)) {
      throw new TeleoperationSessionError('A teleoperation session is already active.', 409);
    }
  }
  await recoverMarkedWorkerProcesses(
    storageDirectory(),
    'robotic_studio.teleoperation.cli',
    STOP_TIMEOUT_MS,
    50,
  );
  let profile: TeleoperationProfileV1;
  try {
    profile = parseTeleoperationProfileV1(input.profile);
  } catch (error) {
    throw new TeleoperationSessionError(
      error instanceof Error ? error.message : 'Teleoperation profile is invalid.',
      400,
    );
  }
  await validateSceneBundle(input);
  const { id, directory } = await sessionDirectory();
  const collection = await sceneCollectionDirectory(
    profile.sceneId,
    profile.sceneFingerprint,
    profile,
  );
  const scenePath = path.join(directory, 'scene.mujoco-scene');
  const profilePath = path.join(directory, 'profile.json');
  const projectPath = integrationPath();
  const runner = resolvePythonRunner(projectPath, 'teleoperation');
  const sessionId = `session-${id}`;
  const collectionId = collection.id;
  const args = [
    ...runner.args,
    '-u',
    '-m',
    'robotic_studio.teleoperation.cli',
    '--scene-bundle',
    scenePath,
    '--profile',
    profilePath,
    '--collection-dir',
    collection.directory,
    '--session-id',
    sessionId,
    '--collection-id',
    collection.id,
    '--no-parent-watch',
  ];
  try {
    const basePort = teleoperationBasePort();
    args.push(
      '--control-port',
      String(basePort),
      '--publisher-port',
      String(basePort + 1),
      '--stream-port',
      String(basePort + 2),
    );
    await copyFile(input.sceneBundlePath, scenePath);
    await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
    const existingPythonPath = process.env.PYTHONPATH
      ? `${projectPath}${path.delimiter}${process.env.PYTHONPATH}`
      : projectPath;
    const child = spawn(/* turbopackIgnore: true */ runner.command, args, {
      cwd: path.resolve(projectPath, '../..'),
      env: { ...pythonWorkerEnvironment(), PYTHONPATH: existingPythonPath },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const dealer = new Dealer({ receiveTimeout: READY_TIMEOUT_MS, sendTimeout: READY_TIMEOUT_MS });
    dealer.routingId = `node-admin-${id}`;
    const record: TeleoperationRecord = {
      summary: {
        protocolVersion: 1,
        sessionId,
        collectionId,
        sceneId: profile.sceneId,
        sceneFingerprint: profile.sceneFingerprint,
        status: 'starting',
        endpoints: { control: '', publisher: '', stream: '' },
        profile,
        activeStateId: 'state-000000',
        stateRevision: 0,
        recording: 'idle',
        pendingRecording: null,
        episodeCount: 0,
        streamHz: profile.streamHz,
        streamSequence: 0,
        states: [],
        episodes: [],
        pid: child.pid ?? null,
      },
      directory,
      collectionDirectory: collection.directory,
      process: child,
      dealer,
      commandSequence: 0,
      commandChain: Promise.resolve(),
      logs: [],
      stdoutBuffer: '',
      closed,
      resolveClosed,
      rawDatasetJob: null,
    };
    managerState.sessions.set(sessionId, record);
    managerState.activeSessionId = sessionId;
    await writeFile(
      path.join(directory, 'process.json'),
      `${JSON.stringify({ pid: child.pid, sessionId })}\n`,
      'utf8',
    );
    child.once('close', (code, signal) => {
      record.resolveClosed();
      record.evaluationRelay?.close();
      removeProcessMarker(record);
      if (record.summary.status !== 'stopping' && record.summary.status !== 'stopped') {
        for (const listener of sessionEndListeners.values()) {
          listener(sessionId).catch((error: unknown) =>
            console.error('Shared streaming session end listener failed.', error),
          );
        }
        record.summary.status = code === 0 ? 'stopped' : 'failed';
        if (code !== 0)
          record.summary.error = `Native teleoperation exited with ${signal || code}.`;
      }
      record.dealer.close();
      if (managerState.activeSessionId === sessionId) managerState.activeSessionId = null;
    });
    const ready = await waitForReady(child, record);
    if (ready.sessionId !== sessionId || ready.collectionId !== collectionId) {
      throw new TeleoperationSessionError(
        'The native process returned mismatched session identity.',
        502,
      );
    }
    record.summary = startSummary(profile, ready, ready.pid);
    await writeFile(
      path.join(directory, 'process.json'),
      `${JSON.stringify({ pid: ready.pid, sessionId })}\n`,
      'utf8',
    );
    record.dealer.connect(ready.endpoints.control);
    await queuedExchange(record, 'hello', { supportedVersions: [1] });
    await describe(record);
    await recordCollectionSource(collection.directory, profile, scenePath).catch((error) =>
      appendLog(record, `[versions] could not record the version source: ${String(error)}`),
    );
    record.summary.carryOver = await carryOverGeneratedScenes(record);
    for (const listener of sessionReadyListeners.values()) {
      listener(cloneSummary(record.summary)).catch((error: unknown) =>
        console.error('Shared streaming session ready listener failed.', error),
      );
    }
    return cloneSummary(record.summary);
  } catch (error) {
    const record = managerState.sessions.get(sessionId);
    if (record) {
      await closeProcess(record).catch(() => undefined);
      await removeProcessMarker(record);
      record.dealer.close();
      managerState.sessions.delete(sessionId);
    }
    if (managerState.activeSessionId === sessionId) managerState.activeSessionId = null;
    await rm(directory, { recursive: true, force: true });
    if (error instanceof TeleoperationSessionError) throw error;
    throw new TeleoperationSessionError(
      error instanceof Error ? error.message : 'The teleoperation session could not start.',
      500,
    );
  }
}

/**
 * When a scene version is opened for the first time (no generated scenes or episodes yet), rebuild
 * the generated scenes of the most recent earlier version in it. Runs once per version: the result
 * is stored with the version and shown in Generate. A failure never blocks the session.
 */
async function carryOverGeneratedScenes(
  record: TeleoperationRecord,
): Promise<TeleoperationCarryOverV1 | null> {
  const existing = await readCarryOver(record.collectionDirectory);
  if (existing) return existing;
  const summary = record.summary;
  const fresh =
    summary.episodes.length === 0 &&
    summary.states.every((state) => state.stateId === 'state-000000');
  if (!fresh) return null;
  const source = await carryOverSource(summary.sceneId, summary.collectionId).catch(() => null);
  if (!source) return null;
  const carryOver: TeleoperationCarryOverV1 = {
    fromCollectionId: source.collectionId,
    fromUpdatedAt: source.updatedAt,
    carriedAt: new Date().toISOString(),
    imported: [],
    skipped: [],
  };
  try {
    const result = await queuedExchange(
      record,
      'states.import',
      { states: generatedStates(source), originCollectionId: source.collectionId },
      { receiveTimeout: 120_000 },
    );
    if (Array.isArray(result.imported)) {
      carryOver.imported = result.imported.flatMap((entry) =>
        isRecord(entry) &&
        typeof entry.fromStateId === 'string' &&
        isRecord(entry.state) &&
        typeof entry.state.stateId === 'string'
          ? [{ fromStateId: entry.fromStateId, stateId: entry.state.stateId }]
          : [],
      );
    }
    if (Array.isArray(result.skipped)) {
      carryOver.skipped = result.skipped.flatMap((entry) =>
        isRecord(entry) && typeof entry.stateId === 'string' && typeof entry.reason === 'string'
          ? [
              {
                stateId: entry.stateId,
                label: typeof entry.label === 'string' ? entry.label : entry.stateId,
                reason: entry.reason,
              },
            ]
          : [],
      );
    }
    await describe(record);
  } catch (error) {
    carryOver.error = error instanceof Error ? error.message : String(error);
    appendLog(record, `[versions] carrying generated scenes over failed: ${carryOver.error}`);
  }
  await writeCarryOver(record.collectionDirectory, carryOver).catch(() => undefined);
  return carryOver;
}

/** True while a running session records into `collectionId`. */
export function teleoperationCollectionInUse(collectionId: string): boolean {
  for (const record of managerState.sessions.values()) {
    if (
      record.summary.collectionId === collectionId &&
      ['starting', 'ready', 'active', 'stopping'].includes(record.summary.status)
    ) {
      return true;
    }
  }
  return false;
}

/** Why the collection's recordings cannot be archived right now, or null. */
export function teleoperationCollectionBusy(collectionId: string): string | null {
  for (const record of managerState.sessions.values()) {
    if (record.summary.collectionId !== collectionId) continue;
    if (!['starting', 'ready', 'active', 'stopping'].includes(record.summary.status)) continue;
    if (record.summary.recording !== 'idle' || record.summary.pendingRecording !== null) {
      return 'Save or discard the stopped recording before downloading the raw dataset.';
    }
    if (record.summary.batch?.status === 'running') {
      return 'Wait for batch generation to finish before downloading the raw dataset.';
    }
  }
  return null;
}

export function getTeleoperationSession(sessionId?: string): TeleoperationSessionSummary | null {
  const id = sessionId ?? managerState.activeSessionId;
  if (!id) return null;
  const record = managerState.sessions.get(id);
  return record ? cloneSummary(record.summary) : null;
}

export async function refreshTeleoperationSession(
  sessionId?: string,
): Promise<TeleoperationSessionSummary | null> {
  const id = sessionId ?? managerState.activeSessionId;
  if (!id) return null;
  const record = managerState.sessions.get(id);
  if (!record) return null;
  if (record.summary.status === 'ready' || record.summary.status === 'active') {
    await describe(record);
  }
  return cloneSummary(record.summary);
}

function recordFor(sessionId: string): TeleoperationRecord {
  const record = managerState.sessions.get(sessionId);
  if (!record) throw new TeleoperationSessionError('Teleoperation session was not found.', 404);
  if (record.summary.status === 'stopping' || record.summary.status === 'stopped') {
    throw new TeleoperationSessionError('Teleoperation session is stopping or stopped.', 409);
  }
  return record;
}

function episodeFor(record: TeleoperationRecord, episodeId: string): TeleoperationEpisodeSummaryV1 {
  const episode = record.summary.episodes.find((candidate) => candidate.episodeId === episodeId);
  if (!episode) throw new TeleoperationReviewError('Episode not found.', 404);
  return episode;
}

export async function startTeleoperationRecording(
  sessionId: string,
): Promise<TeleoperationSessionSummary> {
  const record = recordFor(sessionId);
  const result = await queuedExchange(record, 'record.start');
  record.summary.recording = 'recording';
  if (typeof result.episodeId === 'string') record.summary.activeEpisodeId = result.episodeId;
  return cloneSummary(record.summary);
}

export async function stopTeleoperationRecording(
  sessionId: string,
): Promise<TeleoperationSessionSummary> {
  const record = recordFor(sessionId);
  record.summary.recording = 'stopping';
  const result = await queuedExchange(record, 'record.stop');
  record.summary.recording = 'idle';
  record.summary.pendingRecording = pendingRecordingFrom(result.pendingRecording);
  updateBackdropProgress(record, result.pendingRecording);
  delete record.summary.activeEpisodeId;
  return cloneSummary(record.summary);
}

export async function saveTeleoperationRecording(
  sessionId: string,
): Promise<TeleoperationSessionSummary> {
  const record = recordFor(sessionId);
  // Allow one second per deferred frame for offline rendering during save.
  const result = await queuedExchange(
    record,
    'record.save',
    {},
    {
      receiveTimeout: 120_000 + (record.summary.backdropDeferredFrames ?? 0) * 1_000,
    },
  );
  record.summary.pendingRecording = null;
  clearBackdropProgress(record);
  const episode = result.episode;
  if (isRecord(episode) && typeof episode.episodeIndex === 'number') {
    record.summary.episodeCount = Math.max(record.summary.episodeCount, episode.episodeIndex + 1);
    record.summary.episodes = [
      ...(record.summary.episodes ?? []).filter(
        (candidate) => candidate.episodeId !== episode.episodeId,
      ),
      episode as unknown as TeleoperationEpisodeSummaryV1,
    ].sort((left, right) => left.episodeIndex - right.episodeIndex);
  }
  return cloneSummary(record.summary);
}

export async function discardTeleoperationRecording(
  sessionId: string,
): Promise<TeleoperationSessionSummary> {
  const record = recordFor(sessionId);
  await queuedExchange(record, 'record.discard');
  record.summary.recording = 'idle';
  record.summary.pendingRecording = null;
  clearBackdropProgress(record);
  delete record.summary.activeEpisodeId;
  return cloneSummary(record.summary);
}

export async function getTeleoperationEpisodeReview(sessionId: string, episodeId: string) {
  const record = recordFor(sessionId);
  await describe(record);
  return getTeleoperationEpisode(record.collectionDirectory, episodeFor(record, episodeId));
}

export async function getTeleoperationEpisodeVideo(
  sessionId: string,
  episodeId: string,
  cameraName: string,
): Promise<TeleoperationVideoFile> {
  const record = recordFor(sessionId);
  return getTeleoperationVideo(
    record.collectionDirectory,
    episodeFor(record, episodeId),
    cameraName,
  );
}

export async function updateTeleoperationEpisode(
  sessionId: string,
  episodeId: string,
  updates: { name?: string; notes?: string },
): Promise<TeleoperationSessionSummary> {
  const record = recordFor(sessionId);
  const result = await queuedExchange(record, 'episode.update', { episodeId, ...updates });
  if (!isRecord(result.episode) || typeof result.episode.episodeId !== 'string') {
    throw new TeleoperationSessionError('The native episode update response was invalid.', 502);
  }
  await describe(record);
  return cloneSummary(record.summary);
}

export async function deleteTeleoperationEpisode(
  sessionId: string,
  episodeId: string,
): Promise<TeleoperationSessionSummary> {
  const record = recordFor(sessionId);
  await queuedExchange(record, 'episode.delete', { episodeId });
  await describe(record);
  return cloneSummary(record.summary);
}

export async function appendTeleoperationState(
  sessionId: string,
  seed: number,
  sourceRandomization: TeleoperationSourceRandomizationV1,
  modelRandomization: readonly ModelRandomizationRuleV1[] = [],
  robotRandomization?: TeleoperationRobotRandomizationV1,
): Promise<{ state: TeleoperationStateSnapshotV1; session: TeleoperationSessionSummary }> {
  const record = recordFor(sessionId);
  const result = await queuedExchange(record, 'state.append', {
    seed,
    sourceRandomization,
    ...(modelRandomization.length > 0 ? { modelRandomization } : {}),
    ...(robotRandomization ? { robotRandomization } : {}),
  });
  if (!isRecord(result.state) || typeof result.state.stateId !== 'string') {
    throw new TeleoperationSessionError('The native state append response was invalid.', 502);
  }
  const state = result.state as unknown as TeleoperationStateSnapshotV1;
  record.summary.activeStateId = result.state.stateId;
  if (typeof result.state.index === 'number') record.summary.stateRevision += 1;
  record.summary.states = [
    ...record.summary.states.filter((candidate) => candidate.stateId !== state.stateId),
    state,
  ].sort((left, right) => left.index - right.index);
  return {
    state,
    session: cloneSummary(record.summary),
  };
}

export async function selectTeleoperationState(
  sessionId: string,
  stateId: string,
): Promise<TeleoperationSessionSummary> {
  const record = recordFor(sessionId);
  const result = await queuedExchange(record, 'state.select', { stateId });
  if (typeof result.stateId !== 'string') {
    throw new TeleoperationSessionError('The native state selection response was invalid.', 502);
  }
  record.summary.activeStateId = result.stateId;
  if (typeof result.stateRevision === 'number') record.summary.stateRevision = result.stateRevision;
  return cloneSummary(record.summary);
}

export async function deleteTeleoperationState(
  sessionId: string,
  stateId: string,
): Promise<TeleoperationSessionSummary> {
  const record = recordFor(sessionId);
  const result = await queuedExchange(record, 'state.delete', { stateId });
  if (result.stateId !== stateId || result.deleted !== true) {
    throw new TeleoperationSessionError('The native state deletion response was invalid.', 502);
  }
  await describe(record);
  return cloneSummary(record.summary);
}

async function batchExchange(
  sessionId: string,
  command: 'batch.start' | 'batch.status' | 'batch.cancel',
  fields: Record<string, unknown> = {},
): Promise<TeleoperationBatchStatusV1> {
  const record = recordFor(sessionId);
  const result = await queuedExchange(record, command, fields);
  if (!isRecord(result.batch)) {
    throw new TeleoperationSessionError(`The native '${command}' response was invalid.`, 502);
  }
  const batch = result.batch as unknown as TeleoperationBatchStatusV1;
  record.summary.batch = batch;
  return { ...batch, failuresByReason: { ...batch.failuresByReason } };
}

export function startTeleoperationBatch(
  sessionId: string,
  options: TeleoperationBatchStartOptions,
): Promise<TeleoperationBatchStatusV1> {
  return batchExchange(sessionId, 'batch.start', { ...options });
}

export function getTeleoperationBatch(sessionId: string): Promise<TeleoperationBatchStatusV1> {
  return batchExchange(sessionId, 'batch.status');
}

export function cancelTeleoperationBatch(sessionId: string): Promise<TeleoperationBatchStatusV1> {
  return batchExchange(sessionId, 'batch.cancel');
}

export async function endTeleoperationSession(
  sessionId?: string,
): Promise<TeleoperationSessionSummary | null> {
  return serializeWorkerOperation(managerState, () => endTeleoperationSessionExclusive(sessionId));
}

async function endTeleoperationSessionExclusive(
  sessionId?: string,
): Promise<TeleoperationSessionSummary | null> {
  const id = sessionId ?? managerState.activeSessionId;
  if (!id) return null;
  const record = managerState.sessions.get(id);
  if (!record) return null;
  record.summary.status = 'stopping';
  for (const listener of sessionEndListeners.values()) {
    await listener(id).catch((error: unknown) =>
      console.error('Shared streaming session end listener failed.', error),
    );
  }
  record.relay?.close();
  record.evaluationRelay?.close();
  record.rawDatasetJob?.abortController.abort();
  try {
    await queuedExchange(record, 'session.shutdown');
  } catch {
    // Process termination below is authoritative when the command channel is already gone.
  }
  await closeProcess(record);
  await removeProcessMarker(record);
  record.summary.status = 'stopped';
  record.dealer.close();
  if (managerState.activeSessionId === id) managerState.activeSessionId = null;
  return cloneSummary(record.summary);
}

function rawDatasetFilename(record: TeleoperationRecord): string {
  return `${safeFilename(record.summary.profile.name)}-raw-dataset-and-training-v${RAW_DATASET_FORMAT_VERSION}.zip`;
}

function rawDatasetPreparationSnapshot(
  record: TeleoperationRecord,
): TeleoperationRawDatasetPreparation {
  const job = record.rawDatasetJob;
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

export async function teleoperationDownload(
  sessionId: string,
  signal?: AbortSignal,
  baseUrl?: string,
): Promise<TeleoperationDownload> {
  const record = recordFor(sessionId);
  await describe(record);
  if (record.summary.recording !== 'idle') {
    throw new TeleoperationSessionError('Stop the active capture before downloading samples.', 409);
  }

  const root = storageDirectory();
  const downloadDirectory = path.join(root, 'downloads');
  await mkdir(downloadDirectory, { recursive: true });
  const archivePath = path.join(downloadDirectory, `${record.summary.sessionId}.zip`);
  const controlBundle = await readControlBundle(integrationPath(), record.summary.profile.name);
  const activeState = record.summary.states.find(
    (state) => state.stateId === record.summary.activeStateId,
  );
  const sourceBody =
    activeState?.sourceRandomization?.target ??
    record.summary.profile.sourceRandomization?.body ??
    'asset_cube';
  const rootFiles: Record<string, string> = {
    ...controlBundle,
    'connection.json': `${JSON.stringify(
      {
        protocolVersion: 1,
        sessionId: record.summary.sessionId,
        ...(baseUrl
          ? {
              baseUrl,
              relay: nativeRelayEndpoints('teleoperation', record.summary.sessionId),
            }
          : {}),
        collectionId: record.summary.collectionId,
        sceneId: record.summary.sceneId,
        sceneFingerprint: record.summary.sceneFingerprint,
        sourceBody,
        endpoints: record.summary.endpoints,
      },
      null,
      2,
    )}\n`,
  };
  const archive = await createZipArchive({
    sourceDirectory: record.directory,
    archivePath,
    storageRoot: root,
    rootFiles,
    excludePaths: ['process.json', 'scene.mujoco-scene'],
    signal,
  });
  return {
    archivePath: archive.archivePath,
    filename: `${safeFilename(record.summary.profile.name)}-control-examples.zip`,
    size: archive.size,
  };
}

async function buildTeleoperationRawDataset(
  record: TeleoperationRecord,
  job: RawDatasetJob,
): Promise<TeleoperationDownload & { inventorySignature: string }> {
  if (record.summary.recording !== 'idle' || record.summary.pendingRecording !== null) {
    throw new TeleoperationSessionError(
      'Save or discard the stopped recording before downloading the raw dataset.',
      409,
    );
  }
  if (recordedEpisodes(record).length === 0) {
    throw new TeleoperationSessionError(
      'Save at least one recorded episode before downloading the raw dataset.',
      409,
    );
  }

  const root = storageDirectory();
  const inventoryBefore = await rawDatasetInventorySignature(record);
  const datasetDirectory = path.join(record.collectionDirectory, 'dataset');
  const archiveName = rawDatasetArchiveName(inventoryBefore);
  const archivePath = path.join(record.collectionDirectory, archiveName);
  const collectionMetadataPath = path.join(record.collectionDirectory, 'collection.json');
  const profilePath = path.join(record.directory, 'profile.json');
  const scenePath = path.join(record.directory, 'scene.mujoco-scene');
  job.phase = 'checking-cache';
  try {
    const [archiveInfo, collectionInfo] = await Promise.all([
      stat(archivePath),
      stat(collectionMetadataPath),
    ]);
    if (
      archiveInfo.isFile() &&
      archiveInfo.mtimeMs >= collectionInfo.mtimeMs &&
      (await isZip64Archive(archivePath))
    ) {
      return {
        archivePath,
        filename: rawDatasetFilename(record),
        size: archiveInfo.size,
        inventorySignature: inventoryBefore,
      };
    }
    if (archiveInfo.isFile()) await rm(archivePath, { force: true });
  } catch {
    // Build the archive when the cache is missing or its metadata cannot be read.
  }
  const additionalFiles: ZipArchiveAdditionalFile[] = [
    {
      absolutePath: profilePath,
      archivePath: 'profile.json',
    },
    {
      absolutePath: scenePath,
      archivePath: 'scene.mujoco-scene',
    },
  ];
  job.phase = 'generating-training-environment';
  const [trainingFiles, projectSources, collectionMetadata] = await Promise.all([
    readTrainingBundle(integrationPath()),
    readPythonProjectSources(path.join(integrationPath(), 'robotic_studio')),
    rawCollectionMetadata(record),
  ]);
  job.phase = 'archiving';
  const downloadsDirectory = path.join(root, 'downloads');
  const stagedArchivePath = path.join(
    downloadsDirectory,
    `${record.summary.sessionId}-${inventoryBefore}-${randomUUID()}.staged.zip`,
  );
  await mkdir(downloadsDirectory, { recursive: true });
  // Archives for older inventories can never be served again, and staged files from interrupted
  // builds are orphaned; both are full-size copies of the dataset, so free them before the
  // archive writer checks for disk space.
  const removedArchives = await pruneRawDatasetArchives(record.collectionDirectory, archiveName);
  const removedStaged = await removeOrphanedStagedArchives(
    downloadsDirectory,
    activeStagedRawDatasets,
  );
  for (const name of [...removedArchives, ...removedStaged]) {
    appendLog(record, `[raw-dataset] removed stale archive ${name}`);
  }
  activeStagedRawDatasets.add(stagedArchivePath);
  try {
    const archive = await createZipArchive({
      sourceDirectory: datasetDirectory,
      archivePath: stagedArchivePath,
      storageRoot: root,
      sourcePrefix: 'raw',
      excludePaths: RAW_DATASET_EXCLUDED_PATHS,
      additionalFiles,
      rootFiles: {
        ...trainingFiles,
        ...projectSources,
        'collection.json': collectionMetadata,
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
    const inventoryAfter = await rawDatasetInventorySignature(record);
    if (inventoryAfter !== inventoryBefore) {
      throw new TeleoperationSessionError(
        'The recording data changed while the raw dataset was being prepared. Retry the download.',
        409,
      );
    }
    await rename(stagedArchivePath, archivePath);
    return {
      archivePath,
      filename: rawDatasetFilename(record),
      size: archive.size,
      inventorySignature: inventoryBefore,
    };
  } catch (error) {
    await rm(stagedArchivePath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    activeStagedRawDatasets.delete(stagedArchivePath);
  }
}

async function rawDatasetJobIsCurrent(
  record: TeleoperationRecord,
  job: RawDatasetJob,
): Promise<boolean> {
  if (job.inventorySignature === null || !job.download) return false;
  try {
    return (await rawDatasetInventorySignature(record)) === job.inventorySignature;
  } catch {
    return false;
  }
}

async function rawDatasetInventorySignature(record: TeleoperationRecord): Promise<string> {
  try {
    const [trainingFiles, projectSources] = await Promise.all([
      readTrainingBundle(integrationPath()),
      readPythonProjectSources(path.join(integrationPath(), 'robotic_studio')),
    ]);
    return await inventorySignature({
      collectionDirectory: record.collectionDirectory,
      sessionDirectory: record.directory,
      sourceFiles: { ...trainingFiles, ...projectSources },
    });
  } catch (error) {
    if (error instanceof RawDatasetCacheError) {
      throw new TeleoperationSessionError(error.message, error.status);
    }
    throw error;
  }
}

export async function getTeleoperationRawDatasetPreparation(
  sessionId: string,
): Promise<TeleoperationRawDatasetPreparation> {
  return rawDatasetPreparationSnapshot(recordFor(sessionId));
}

export async function prepareTeleoperationRawDataset(
  sessionId: string,
): Promise<TeleoperationRawDatasetPreparation> {
  const record = recordFor(sessionId);
  await describe(record);
  const existing = record.rawDatasetJob;
  if (existing?.status === 'preparing') {
    return rawDatasetPreparationSnapshot(record);
  }
  if (existing?.status === 'ready' && (await rawDatasetJobIsCurrent(record, existing))) {
    return rawDatasetPreparationSnapshot(record);
  }

  const job: RawDatasetJob = {
    status: 'preparing',
    phase: 'checking-cache',
    processedBytes: 0,
    totalBytes: null,
    download: null,
    error: null,
    inventorySignature: null,
    abortController: new AbortController(),
    cancelled: false,
    settled: Promise.resolve(),
  };
  job.settled = (async () => {
    try {
      const download = await buildTeleoperationRawDataset(record, job);
      job.download = download;
      job.inventorySignature = download.inventorySignature;
      job.status = 'ready';
      job.phase = 'complete';
      job.processedBytes = job.download.size;
      job.totalBytes = job.download.size;
    } catch (error) {
      job.status = 'failed';
      job.phase = 'failed';
      job.error = job.cancelled
        ? 'The raw dataset preparation was cancelled.'
        : error instanceof Error
          ? error.message
          : String(error);
      if (!job.cancelled) {
        console.error(
          `[teleoperation] raw dataset preparation failed for session ${sessionId}:`,
          error,
        );
      }
    }
  })();
  record.rawDatasetJob = job;
  return rawDatasetPreparationSnapshot(record);
}

export async function cancelTeleoperationRawDataset(
  sessionId: string,
): Promise<TeleoperationRawDatasetPreparation> {
  const record = recordFor(sessionId);
  const job = record.rawDatasetJob;
  if (job?.status === 'preparing') {
    job.cancelled = true;
    job.abortController.abort();
    // Wait for the background build to stop touching the filesystem before this call
    // resolves, so a subsequent prepare cannot race the cancelled build's rename onto
    // the shared archive path. The build's own catch clause already records failure.
    await job.settled.catch(() => {});
    record.rawDatasetJob = null;
  }
  return rawDatasetPreparationSnapshot(record);
}

export async function getTeleoperationRawDatasetDownload(
  sessionId: string,
): Promise<TeleoperationDownload> {
  const record = recordFor(sessionId);
  const job = record.rawDatasetJob;
  if (!job || job.status !== 'ready' || !job.download) {
    throw new TeleoperationSessionError(
      'Prepare the raw dataset before downloading the archive.',
      409,
    );
  }
  if (!(await rawDatasetJobIsCurrent(record, job))) {
    throw new TeleoperationSessionError(
      'The recording data changed after the raw dataset was prepared. Prepare it again.',
      409,
    );
  }
  return job.download;
}

export async function getTeleoperationSceneBundle(
  sessionId: string,
): Promise<TeleoperationSceneBundle> {
  const record = recordFor(sessionId);
  const scenePath = path.join(record.directory, 'scene.mujoco-scene');
  let scene;
  try {
    scene = await stat(scenePath);
  } catch {
    throw new TeleoperationSessionError('The teleoperation scene bundle could not be read.', 500);
  }
  if (!scene.isFile()) {
    throw new TeleoperationSessionError('The teleoperation scene bundle could not be read.', 500);
  }
  return {
    scenePath,
    filename: `${safeFilename(record.summary.profile.name)}.mujoco-scene`,
    size: scene.size,
  };
}

export async function cleanupTeleoperationSessions(): Promise<void> {
  for (const id of managerState.sessions.keys()) await endTeleoperationSession(id);
}

registerSceneSessionCleanup('generate', async (sceneId) => {
  for (const [id, record] of managerState.sessions) {
    if (record.summary.sceneId !== sceneId) continue;
    await endTeleoperationSession(id);
    await record.rawDatasetJob?.settled.catch(() => undefined);
    managerState.sessions.delete(id);
  }
});

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { dataPath } from '@mujoco-studio/payload/storage';

import { integrationPath } from '@/lib/process/integrationPaths';
import {
  removeUntrackedSessionDirectories,
  resolvePythonRunner,
} from '@/lib/process/pythonWorkerProcess';
import { runOneShotProcess } from '@/lib/process/runOneShotProcess';

import { isEditorConnected, onEditorDisconnect } from './bridge';

/** One real recording per MCP connection for now. */
const MAX_DATASETS = 1;
export const MAX_DATASET_UPLOAD_BYTES = 2 * 1024 ** 3;
const PREPARE_TIMEOUT_MS = 10 * 60_000;
const READ_TIMEOUT_MS = 60_000;

export type SharedDatasetSource = 'editor' | 'agent';

export interface DatasetCamera {
  key: string;
  name: string;
  width: number;
  height: number;
  codec: string | null;
  fps: number;
}
interface DatasetEpisode {
  index: number;
  length: number;
  durationSeconds: number;
  tasks: string[];
}
interface PreparedDataset {
  root: string;
  codebaseVersion: string;
  robotType: string | null;
  fps: number;
  totalEpisodes: number;
  totalFrames: number;
  cameras: DatasetCamera[];
  state: { key: string; names: string[] } | null;
  action: { key: string; names: string[] } | null;
  episodes: DatasetEpisode[];
  episodesTruncated: boolean;
  unsupportedImageFeatures?: string[];
}
export interface DatasetTrajectory {
  episode: number;
  fps: number;
  frames: number;
  timestamps: number[];
  stateNames: string[];
  actionNames: string[];
  state: number[][] | null;
  action: number[][] | null;
  stateRange?: { min: number[]; max: number[] };
}
interface Dataset {
  id: string;
  name: string;
  sizeBytes: number;
  source: SharedDatasetSource;
  importedAt: string;
  directory: string;
  prepared: PreparedDataset;
  trajectories: Map<number, Promise<DatasetTrajectory>>;
}
interface DatasetSession {
  datasets: Map<string, Dataset>;
  importing: number;
}

const globalDatasets = globalThis as typeof globalThis & {
  sceneMcpDatasetSessions?: Map<string, DatasetSession>;
  sceneMcpDatasetCleanup?: Promise<void>;
};
const datasetSessions = (globalDatasets.sceneMcpDatasetSessions ??= new Map<
  string,
  DatasetSession
>());

const datasetsRoot = () => dataPath('mcp-datasets');

onEditorDisconnect((editorToken) => {
  const session = datasetSessions.get(editorToken);
  datasetSessions.delete(editorToken);
  for (const dataset of session?.datasets.values() ?? []) {
    void rm(dataset.directory, { recursive: true, force: true });
  }
});

/** Datasets live only as long as their MCP connection; a restart leaves folders nobody owns. */
function removeStaleDatasets(): Promise<void> {
  return (globalDatasets.sceneMcpDatasetCleanup ??= removeUntrackedSessionDirectories(
    datasetsRoot(),
    [...datasetSessions.values()].flatMap((session) =>
      [...session.datasets.values()].map((dataset) => dataset.directory),
    ),
  ).catch(() => undefined));
}

function sessionFor(editorToken: string): DatasetSession {
  if (!isEditorConnected(editorToken)) {
    throw new Error('MCP connection expired. Disable and enable MCP again.');
  }
  let session = datasetSessions.get(editorToken);
  if (!session) {
    session = { datasets: new Map(), importing: 0 };
    datasetSessions.set(editorToken, session);
  }
  return session;
}

export type SharedDatasetSummary = ReturnType<typeof datasetSummary>;
function datasetSummary({
  directory: _directory,
  prepared,
  trajectories: _t,
  ...dataset
}: Dataset) {
  const { root: _root, ...summary } = prepared;
  return { ...dataset, ...summary };
}

async function runReader(
  args: readonly string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const runner = resolvePythonRunner(integrationPath(), 'teleoperation');
  const result = await runOneShotProcess(
    runner.command,
    [...runner.args, '-m', 'robotic_studio.dataset_import', ...args],
    { cwd: integrationPath(), timeoutMs, signal },
  );
  if (result.code !== 0) {
    const detail = result.stderr.trim().split(/\r?\n/).filter(Boolean).at(-1);
    throw new Error(detail || 'The dataset could not be read.');
  }
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1) ?? 'null');
}

async function writeUpload(body: ReadableStream<Uint8Array>, file: string): Promise<number> {
  const handle = await open(file, 'wx', 0o640);
  const reader = body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return total;
      total += value.byteLength;
      if (total > MAX_DATASET_UPLOAD_BYTES) {
        await reader.cancel();
        throw new Error('Share a dataset zip smaller than 2 GB (one recording).');
      }
      await handle.write(value);
    }
  } finally {
    await handle.close();
  }
}

/** Saves an uploaded LeRobot v3 zip for this MCP connection, extracts it, and reads its metadata. */
export async function importDataset(
  editorToken: string,
  upload: {
    body: ReadableStream<Uint8Array> | null;
    name: string;
    source: SharedDatasetSource;
    signal?: AbortSignal;
  },
): Promise<SharedDatasetSummary> {
  if (!upload.body) throw new Error('Send the dataset zip as the request body.');
  await removeStaleDatasets();
  const session = sessionFor(editorToken);
  if (session.datasets.size + session.importing >= MAX_DATASETS) {
    throw new Error('Remove the shared dataset first; one recording can be shared at a time.');
  }
  session.importing += 1;
  const id = randomUUID();
  const directory = dataPath('mcp-datasets', id);
  try {
    await mkdir(directory, { recursive: true, mode: 0o750 });
    const archive = path.join(directory, 'upload.zip');
    const sizeBytes = await writeUpload(upload.body, archive);
    if (!sizeBytes) throw new Error('The dataset upload is empty.');
    const prepared = (await runReader(
      ['prepare', archive, directory],
      PREPARE_TIMEOUT_MS,
      upload.signal,
    )) as PreparedDataset;
    await rm(archive, { force: true });
    if (!path.resolve(prepared.root).startsWith(`${directory}${path.sep}`)) {
      throw new Error('The dataset reader returned an unexpected folder.');
    }
    if (datasetSessions.get(editorToken) !== session) {
      throw new Error('MCP connection expired. Disable and enable MCP again.');
    }
    const dataset: Dataset = {
      id,
      name: upload.name.trim().slice(0, 200) || 'dataset.zip',
      sizeBytes,
      source: upload.source,
      importedAt: new Date().toISOString(),
      directory,
      prepared,
      trajectories: new Map(),
    };
    session.datasets.set(id, dataset);
    return datasetSummary(dataset);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  } finally {
    session.importing -= 1;
  }
}

export async function removeDataset(editorToken: string, datasetId: string) {
  const session = sessionFor(editorToken);
  const dataset = session.datasets.get(datasetId);
  if (!dataset) return;
  session.datasets.delete(datasetId);
  await rm(dataset.directory, { recursive: true, force: true });
}

export function listDatasets(editorToken: string): SharedDatasetSummary[] {
  return [...(datasetSessions.get(editorToken)?.datasets.values() ?? [])].map(datasetSummary);
}

function datasetFor(editorToken: string, datasetId: string, episode?: number): Dataset {
  const dataset = datasetSessions.get(editorToken)?.datasets.get(datasetId);
  if (!dataset) throw new Error('Unknown datasetId. Call list_datasets for the shared dataset.');
  const { episodes, episodesTruncated } = dataset.prepared;
  if (
    episode !== undefined &&
    !episodesTruncated &&
    !episodes.some((item) => item.index === episode)
  ) {
    throw new Error(
      `Episode ${episode} is not in this dataset; it has ${episodes.map((item) => item.index).join(', ')}.`,
    );
  }
  return dataset;
}

export function datasetCameras(editorToken: string, datasetId: string): DatasetCamera[] {
  return datasetFor(editorToken, datasetId).prepared.cameras;
}

/** Each requested camera's frame (PNG bytes) at `time` seconds into the episode. */
export async function datasetFrames(
  editorToken: string,
  input: { datasetId: string; episode: number; time: number; cameras?: readonly string[] },
) {
  const dataset = datasetFor(editorToken, input.datasetId, input.episode);
  const known = new Set(dataset.prepared.cameras.map((camera) => camera.key));
  const unknown = (input.cameras ?? []).filter((key) => !known.has(key));
  if (unknown.length) {
    throw new Error(
      `Unknown camera ${unknown.join(', ')}; the dataset has ${[...known].join(', ')}.`,
    );
  }
  const output = path.join(dataset.directory, 'frames', randomUUID());
  try {
    const result = (await runReader(
      [
        'frames',
        dataset.prepared.root,
        String(input.episode),
        String(input.time),
        output,
        ...(input.cameras ?? []).flatMap((key) => ['--camera', key]),
      ],
      READ_TIMEOUT_MS,
    )) as {
      episode: number;
      time: number;
      frameIndex: number;
      cameras: { key: string; name: string; width: number; height: number; path: string }[];
    };
    const cameras = await Promise.all(
      result.cameras.map(async ({ path: file, ...camera }) => {
        if (!path.resolve(file).startsWith(`${output}${path.sep}`)) {
          throw new Error('The dataset reader returned an unexpected file.');
        }
        return { ...camera, png: await readFile(file) };
      }),
    );
    return { episode: result.episode, time: result.time, frameIndex: result.frameIndex, cameras };
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}

/** The episode's recorded joint states and actions, read once per episode. */
export function datasetTrajectory(
  editorToken: string,
  datasetId: string,
  episode: number,
): Promise<DatasetTrajectory> {
  const dataset = datasetFor(editorToken, datasetId, episode);
  let trajectory = dataset.trajectories.get(episode);
  if (!trajectory) {
    trajectory = runReader(
      ['trajectory', dataset.prepared.root, String(episode)],
      READ_TIMEOUT_MS,
    ) as Promise<DatasetTrajectory>;
    dataset.trajectories.set(episode, trajectory);
    trajectory.catch(() => dataset.trajectories.delete(episode));
  }
  return trajectory;
}

/** Edge alignment and brightness of a render against a real frame, with a review image. */
export async function compareWithFrame(
  editorToken: string,
  datasetId: string,
  real: Uint8Array,
  simulated: Uint8Array,
) {
  const dataset = datasetFor(editorToken, datasetId);
  const directory = path.join(dataset.directory, 'compare', randomUUID());
  try {
    await mkdir(directory, { recursive: true, mode: 0o750 });
    const realPath = path.join(directory, 'real.png');
    const simulatedPath = path.join(directory, 'sim.png');
    const reviewPath = path.join(directory, 'review.png');
    await Promise.all([
      writeFile(realPath, real, { flag: 'wx', mode: 0o640 }),
      writeFile(simulatedPath, simulated, { flag: 'wx', mode: 0o640 }),
    ]);
    const { reviewImage: _reviewImage, ...metrics } = (await runReader(
      ['compare', realPath, simulatedPath, reviewPath],
      READ_TIMEOUT_MS,
    )) as Record<string, unknown> & { reviewImage: string };
    return { metrics, review: await readFile(reviewPath) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

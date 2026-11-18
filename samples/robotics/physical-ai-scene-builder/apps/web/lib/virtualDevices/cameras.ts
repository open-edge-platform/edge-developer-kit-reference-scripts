// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import { registerSceneSessionCleanup } from '@mujoco-studio/payload/scene-runtime-cleanup';

import {
  getEvaluationSession,
  onEvaluationSessionEnded,
  onEvaluationStreamStopped,
  type EvaluationSessionSummary,
} from '../evaluation/sessionManager';
import {
  installShutdownHandler,
  resolvePythonRunner,
  serializeWorkerOperation,
  waitForExitOrForceKill,
} from '../process/pythonWorkerProcess';
import { integrationPath } from '../teleoperation/sessionManager';
import { VirtualDeviceError } from './so101';
import { resolveDeviceTarget, targetArguments } from './target';

const STOP_TIMEOUT_MS = 8_000;
const MAX_LOG_LINES = 100;
const FEED_FPS = 30;

export type VirtualCameraState = 'off' | 'starting' | 'ready' | 'failed' | 'stopped';
const CAMERA_STATES: readonly VirtualCameraState[] = [
  'off',
  'starting',
  'ready',
  'failed',
  'stopped',
];

/** A scene camera that can be exposed as a `/dev/video<n>` webcam while streaming is on. */
export interface VirtualCameraStatus {
  name: string;
  width: number;
  height: number;
  enabled: boolean;
  state: VirtualCameraState;
  device: string | null;
  error: string | null;
}

export interface VirtualCamerasStatus {
  /** Whether a streaming Simulate session is ready, which the cameras render from. */
  streaming: boolean;
  sceneId: string | null;
  cameras: VirtualCameraStatus[];
  error: string | null;
  logs: string[];
}

interface FeedRecord {
  sessionId: string;
  sceneId: string;
  status: 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';
  process: ChildProcess;
  exited: Promise<void>;
  stdoutBuffer: string;
  /** The feed's latest report, keyed by camera name. */
  cameras: Map<string, VirtualCameraStatus>;
  error: string | null;
}

interface VirtualCamerasState {
  feed: FeedRecord | null;
  /** Cameras turned on for one stream; every stream starts with all cameras off. */
  enabled?: { sessionId: string; names: string[] } | null;
  /** The last error that is not tied to a running feed, such as Studio not being found. */
  error: { sessionId: string; message: string } | null;
  logs: string[];
  studioUrl: string | null;
  starting: boolean;
  operationChain: Promise<void>;
  shutdownPromise: Promise<void> | null;
  installed: boolean;
}

const stateKey = Symbol.for('mujoco-studio.virtual-cameras');
const stateGlobal = globalThis as typeof globalThis & { [stateKey]?: VirtualCamerasState };
const state =
  stateGlobal[stateKey] ??
  (stateGlobal[stateKey] = {
    feed: null,
    enabled: null,
    error: null,
    logs: [],
    studioUrl: null,
    starting: false,
    operationChain: Promise.resolve(),
    shutdownPromise: null,
    installed: false,
  });
installShutdownHandler(state, () => serializeWorkerOperation(state, stopFeed));

interface SceneCamera {
  name: string;
  outputName: string;
  width: number;
  height: number;
}

function sceneCameras(session: EvaluationSessionSummary): SceneCamera[] {
  const cameras = session.profile.cameras;
  if (!Array.isArray(cameras)) return [];
  return cameras.flatMap((item): SceneCamera[] => {
    if (typeof item !== 'object' || item === null) return [];
    const camera = item as Record<string, unknown>;
    const name = typeof camera.camera === 'string' ? camera.camera : null;
    if (!name) return [];
    return [
      {
        name,
        outputName: typeof camera.outputName === 'string' ? camera.outputName : name,
        width: typeof camera.width === 'number' ? camera.width - (camera.width % 2) : 0,
        height: typeof camera.height === 'number' ? camera.height : 0,
      },
    ];
  });
}

function streamingSession(): EvaluationSessionSummary | null {
  const session = getEvaluationSession();
  return session?.status === 'ready' ? session : null;
}

function appendLog(line: string): void {
  state.logs.push(line.slice(0, 2_000));
  if (state.logs.length > MAX_LOG_LINES) state.logs.shift();
}

function enabledNames(sessionId: string): string[] {
  return state.enabled?.sessionId === sessionId ? state.enabled.names : [];
}

function feedAlive(feed: FeedRecord | null): feed is FeedRecord {
  return (
    feed !== null &&
    (feed.status === 'starting' || feed.status === 'ready') &&
    feed.process.exitCode === null &&
    feed.process.signalCode === null
  );
}

function parseCameras(value: unknown): VirtualCameraStatus[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((item): VirtualCameraStatus[] => {
    if (typeof item !== 'object' || item === null) return [];
    const camera = item as Record<string, unknown>;
    if (typeof camera.name !== 'string') return [];
    return [
      {
        name: camera.name,
        width: typeof camera.width === 'number' ? camera.width : 0,
        height: typeof camera.height === 'number' ? camera.height : 0,
        enabled: camera.enabled === true,
        state: CAMERA_STATES.includes(camera.state as VirtualCameraState)
          ? (camera.state as VirtualCameraState)
          : 'off',
        device: typeof camera.device === 'string' ? camera.device : null,
        error: typeof camera.error === 'string' ? camera.error : null,
      },
    ];
  });
}

function handleMessage(feed: FeedRecord, line: string): void {
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(line) as Record<string, unknown>;
  } catch {
    appendLog(line);
    return;
  }
  switch (message.type) {
    case 'ready':
    case 'status': {
      if (message.type === 'ready' && feed.status === 'starting') feed.status = 'ready';
      for (const camera of parseCameras(message.cameras) ?? []) {
        feed.cameras.set(camera.name, camera);
      }
      break;
    }
    case 'error':
      feed.error = typeof message.message === 'string' ? message.message : 'Unknown error.';
      appendLog(feed.error);
      break;
    case 'log':
      if (typeof message.message === 'string') appendLog(message.message);
      break;
    default:
      break;
  }
}

function cameraStatus(
  camera: SceneCamera,
  enabled: boolean,
  feed: FeedRecord | null,
): VirtualCameraStatus {
  const base = {
    name: camera.name,
    width: camera.width,
    height: camera.height,
    enabled,
    device: null,
    error: null,
  };
  if (!enabled) return { ...base, state: 'off' };
  if (!feed) return { ...base, state: 'stopped' };
  if (feed.status === 'failed') {
    return { ...base, state: 'failed', error: feed.error ?? 'The camera feed stopped.' };
  }
  if (feed.status !== 'starting' && feed.status !== 'ready') return { ...base, state: 'stopped' };
  const reported = feed.cameras.get(camera.name);
  if (!reported?.enabled) return { ...base, state: 'starting' };
  return { ...reported, enabled: true };
}

/** The streaming scene's cameras and which of them are exposed as virtual webcams. */
export async function getVirtualCameras(): Promise<VirtualCamerasStatus> {
  const session = streamingSession();
  if (!session) {
    return { streaming: false, sceneId: null, cameras: [], error: null, logs: [...state.logs] };
  }
  const enabled = new Set(enabledNames(session.sessionId));
  const feed = state.feed?.sessionId === session.sessionId ? state.feed : null;
  const error =
    feed?.status === 'failed'
      ? feed.error
      : state.error?.sessionId === session.sessionId
        ? state.error.message
        : null;
  return {
    streaming: true,
    sceneId: session.sceneId,
    cameras: sceneCameras(session).map((camera) =>
      cameraStatus(camera, enabled.has(camera.name), feed),
    ),
    error,
    logs: [...state.logs],
  };
}

/** Remembers how camera feeds reach this server; the feed process discovers the session there. */
export function rememberStudioUrl(url: string): void {
  state.studioUrl = url;
}

function studioUrl(): string {
  return state.studioUrl ?? `http://127.0.0.1:${process.env.PORT?.trim() || '3000'}`;
}

async function startFeed(session: EvaluationSessionSummary, cameras: string[]): Promise<void> {
  const target = await resolveDeviceTarget();
  const projectPath = integrationPath();
  const runner = resolvePythonRunner(projectPath, 'teleoperation');
  const args = [
    ...runner.args,
    '-m',
    'robotic_studio.virtual_camera',
    '--studio-url',
    studioUrl(),
    ...targetArguments(target),
    '--fps',
    String(FEED_FPS),
  ];
  for (const camera of cameras) args.push('--camera', camera);
  const existingPythonPath = process.env.PYTHONPATH
    ? `${projectPath}${path.delimiter}${process.env.PYTHONPATH}`
    : projectPath;
  const child = spawn(/* turbopackIgnore: true */ runner.command, args, {
    cwd: path.resolve(projectPath, '../..'),
    env: { ...process.env, PYTHONPATH: existingPythonPath, PYTHONUNBUFFERED: '1' },
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const feed: FeedRecord = {
    sessionId: session.sessionId,
    sceneId: session.sceneId,
    status: 'starting',
    process: child,
    exited: new Promise<void>((resolve) => child.once('exit', () => resolve())),
    stdoutBuffer: '',
    cameras: new Map(),
    error: null,
  };
  state.feed = feed;
  state.error = null;
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    feed.stdoutBuffer += chunk;
    let newline = feed.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = feed.stdoutBuffer.slice(0, newline).trim();
      feed.stdoutBuffer = feed.stdoutBuffer.slice(newline + 1);
      if (line) handleMessage(feed, line);
      newline = feed.stdoutBuffer.indexOf('\n');
    }
  });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    for (const line of chunk.split('\n')) if (line.trim()) appendLog(line.trimEnd());
  });
  child.stdin?.on('error', () => undefined);
  child.once('error', (error) => {
    feed.status = 'failed';
    feed.error = error.message;
  });
  feed.exited.then(() => {
    if (feed.status === 'stopping') {
      feed.status = 'stopped';
    } else if (feed.status !== 'stopped') {
      feed.status = 'failed';
      if (feed.error === null) {
        feed.error = `The camera feed exited with code ${child.exitCode ?? 'unknown'}.`;
      }
    }
    feed.cameras.clear();
  });
}

async function stopFeed(): Promise<void> {
  const feed = state.feed;
  if (!feed) return;
  if (feed.process.exitCode === null && feed.process.signalCode === null) {
    feed.status = 'stopping';
    feed.process.stdin?.end(`${JSON.stringify({ type: 'stop' })}\n`);
    await waitForExitOrForceKill(feed.process, {
      timeoutMs: STOP_TIMEOUT_MS,
      exited: feed.exited,
      onTimeout: () => appendLog('The camera feed did not stop in time; killed it.'),
    });
    await feed.exited;
  }
  if (feed.status !== 'failed') feed.status = 'stopped';
  feed.cameras.clear();
}

export interface SetVirtualCameraInput {
  name: unknown;
  enabled: unknown;
}

/** Turns one scene camera's virtual webcam on or off for the current stream. */
export async function setVirtualCamera(
  input: SetVirtualCameraInput,
): Promise<VirtualCamerasStatus> {
  if (typeof input.name !== 'string' || !input.name) {
    throw new VirtualDeviceError('Choose a camera.');
  }
  if (typeof input.enabled !== 'boolean') {
    throw new VirtualDeviceError("'enabled' must be true or false.");
  }
  const name = input.name;
  const enabled = input.enabled;
  await serializeWorkerOperation(state, async () => {
    const session = streamingSession();
    if (!session) {
      throw new VirtualDeviceError('Turn on Stream to client first.', 409);
    }
    const cameras = sceneCameras(session);
    if (!cameras.some((camera) => camera.name === name)) {
      throw new VirtualDeviceError(`The scene has no camera named '${name}'.`, 404);
    }
    const stored = new Set(enabledNames(session.sessionId));
    if (enabled) stored.add(name);
    else stored.delete(name);
    const names = cameras.map((camera) => camera.name).filter((item) => stored.has(item));
    state.enabled = { sessionId: session.sessionId, names };

    if (state.feed && state.feed.sessionId !== session.sessionId) await stopFeed();
    const feed = state.feed;
    if (names.length === 0) {
      await stopFeed();
    } else if (feedAlive(feed)) {
      feed.process.stdin?.write(`${JSON.stringify({ type: 'camera', name, enabled })}\n`);
      if (!enabled) feed.cameras.delete(name);
    } else {
      await startFeed(session, names);
    }
  }).catch((error: unknown) => {
    if (error instanceof VirtualDeviceError && error.status !== 400 && error.status !== 404) {
      const session = streamingSession();
      if (session) state.error = { sessionId: session.sessionId, message: error.message };
    }
    throw error;
  });
  return getVirtualCameras();
}

async function stopSessionCameras(sessionId: string): Promise<void> {
  await serializeWorkerOperation(state, async () => {
    if (state.enabled?.sessionId === sessionId) state.enabled = null;
    if (state.feed?.sessionId === sessionId) await stopFeed();
  });
}

onEvaluationSessionEnded('virtual-cameras', stopSessionCameras);
onEvaluationStreamStopped('virtual-cameras', stopSessionCameras);

registerSceneSessionCleanup('virtual-cameras', async (sceneId) => {
  if (state.feed?.sceneId === sceneId) await serializeWorkerOperation(state, stopFeed);
});

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { spawn, type ChildProcess } from 'node:child_process';
import { readdir } from 'node:fs/promises';

import { URL_CHARS } from '../http/urlChars';
import {
  installShutdownHandler,
  pythonWorkerEnvironment,
  serializeWorkerOperation,
  waitForExitOrForceKill,
} from './pythonWorkerProcess';
import { trellisPath } from './integrationPaths';

const STARTUP_TIMEOUT_MS = 10 * 60_000;
const STOP_TIMEOUT_MS = 5_000;
const MAX_LOG_LINES = 300;

export type TrellisServiceStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface TrellisServiceState {
  status: TrellisServiceStatus;
  url: string;
  pid: number | null;
  error: string | null;
  logs: string[];
}

interface TrellisManagerState {
  status: TrellisServiceStatus;
  process: ChildProcess | null;
  error: string | null;
  logs: string[];
  starting: boolean;
  operationChain: Promise<void>;
  shutdownPromise: Promise<void> | null;
  installed: boolean;
}

const managerStateKey = Symbol.for('mujoco-studio.trellis-service-manager');
const managerGlobal = globalThis as typeof globalThis & {
  [managerStateKey]?: TrellisManagerState;
};
const managerState =
  managerGlobal[managerStateKey] ??
  (managerGlobal[managerStateKey] = {
    status: 'stopped',
    process: null,
    error: null,
    logs: [],
    starting: false,
    operationChain: Promise.resolve(),
    shutdownPromise: null,
    installed: false,
  });

installShutdownHandler(managerState, async () => {
  if (managerState.process) await stopTrellisService();
});

function appendLog(value: string): void {
  managerState.logs.push(value.slice(0, 4_096));
  if (managerState.logs.length > MAX_LOG_LINES) managerState.logs.shift();
}

export function trellisApiUrl(): string {
  return (process.env.ROBOTIC_STUDIO_TRELLIS_API_URL?.trim() || 'http://127.0.0.1:8000').replace(
    /\/+$/,
    '',
  );
}

export async function checkGpuAvailability(): Promise<boolean> {
  try {
    return (await readdir('/dev/dri')).some((entry) => /^renderD\d+$/.test(entry));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function isTrellisHealthy(): Promise<boolean> {
  let healthUrl = '';
  for (const character of `${trellisApiUrl()}/health`) {
    let allowedCharacter = '';
    for (const allowed of URL_CHARS) {
      if (allowed === character) {
        allowedCharacter = allowed;
        break;
      }
    }
    if (!allowedCharacter) return false;
    healthUrl += allowedCharacter;
  }
  try {
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { status?: string };
    return body.status === 'ready';
  } catch (error) {
    if (
      error instanceof TypeError ||
      error instanceof DOMException ||
      error instanceof SyntaxError
    ) {
      return false;
    }
    throw error;
  }
}

export function getTrellisServiceState(): TrellisServiceState {
  return {
    status: managerState.status,
    url: trellisApiUrl(),
    pid: managerState.process?.pid ?? null,
    error: managerState.error,
    logs: [...managerState.logs],
  };
}

export async function refreshTrellisServiceState(): Promise<TrellisServiceState> {
  if (managerState.status === 'starting') return getTrellisServiceState();
  const child = managerState.process;
  const healthy = await isTrellisHealthy();
  if (child !== managerState.process || getTrellisServiceState().status === 'starting') {
    return getTrellisServiceState();
  }
  if (healthy) {
    managerState.status = 'running';
    managerState.error = null;
  } else if (managerState.status === 'running') {
    managerState.status = 'error';
    managerState.error = 'TRELLIS.2 is not responding. Stop and restart the service.';
  }
  return getTrellisServiceState();
}

function signalOwnedProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
  }
}

async function stopOwnedProcess(): Promise<void> {
  const child = managerState.process;
  if (!child) return;
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    managerState.process = null;
    return;
  }
  signalOwnedProcess(child, 'SIGTERM');
  await waitForExitOrForceKill(child, {
    timeoutMs: STOP_TIMEOUT_MS,
    onTimeout: () => signalOwnedProcess(child, 'SIGKILL'),
  });
  if (managerState.process === child) managerState.process = null;
}

async function awaitReadiness(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (managerState.process === child && managerState.status === 'starting') {
    if (await isTrellisHealthy()) {
      if (managerState.process === child && managerState.status === 'starting') {
        managerState.status = 'running';
      }
      return;
    }
    if (Date.now() >= deadline) {
      await serializeWorkerOperation(managerState, async () => {
        if (managerState.process !== child) return;
        managerState.status = 'error';
        managerState.error = 'TRELLIS.2 did not become ready in time. Check the service logs.';
        await stopOwnedProcess();
      });
      return;
    }
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 1_000));
  }
}

export function startTrellisService(): Promise<TrellisServiceState> {
  return serializeWorkerOperation(managerState, async () => {
    if (managerState.status === 'starting') return getTrellisServiceState();
    if ((await refreshTrellisServiceState()).status === 'running') {
      return getTrellisServiceState();
    }
    const url = new URL(trellisApiUrl());
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new Error(
        'Start TRELLIS.2 on its configured host, then check the service status again.',
      );
    }
    await stopOwnedProcess();
    const projectPath = trellisPath();
    const command = process.env.ROBOTIC_STUDIO_UV?.trim() || 'uv';
    const args = [
      'run',
      '--project',
      projectPath,
      '--locked',
      'uvicorn',
      'trellis2_api:app',
      '--host',
      url.hostname.replace(/^\[|\]$/g, ''),
      '--port',
      url.port || '8000',
    ];
    managerState.status = 'starting';
    managerState.error = null;
    managerState.logs = [];
    appendLog(`$ ${command} ${args.join(' ')}`);
    const child = spawn(/* turbopackIgnore: true */ command, args, {
      cwd: projectPath,
      env: pythonWorkerEnvironment(),
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    managerState.process = child;
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString('utf8').split(/\r?\n/)) if (line) appendLog(line);
      });
    }
    const failed = (message: string) => {
      if (managerState.process !== child) return;
      managerState.process = null;
      if (managerState.status === 'starting' || managerState.status === 'running') {
        managerState.status = 'error';
        managerState.error = message;
        appendLog(message);
      }
    };
    child.once('error', (error) => failed(error.message));
    child.once('exit', (code, signal) => failed(`TRELLIS.2 exited with ${signal ?? code}.`));
    awaitReadiness(child).catch((error: unknown) => {
      if (managerState.process !== child) return;
      managerState.status = 'error';
      managerState.error = error instanceof Error ? error.message : String(error);
      appendLog(managerState.error);
    });
    return getTrellisServiceState();
  });
}

export function stopTrellisService(): Promise<void> {
  return serializeWorkerOperation(managerState, async () => {
    if (!managerState.process && managerState.status === 'running') {
      throw new Error('This TRELLIS.2 service is externally managed. Stop it on its host.');
    }
    managerState.status = 'stopped';
    await stopOwnedProcess();
    managerState.error = null;
  });
}

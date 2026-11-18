// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ChildProcess } from 'node:child_process';
import { readdir, readFile, rm, unlink } from 'node:fs/promises';
import path from 'node:path';

export interface PythonRunner {
  command: string;
  args: string[];
}

export function pythonWorkerEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const restored = { ...environment };
  const suffix = '_VSCODE_SNAP_ORIG';
  for (const [name, value] of Object.entries(environment)) {
    if (!name.endsWith(suffix)) continue;
    const originalName = name.slice(0, -suffix.length);
    if (value) restored[originalName] = value;
    else delete restored[originalName];
    delete restored[name];
  }
  return restored;
}

/**
 * Resolves how to invoke a Python worker: a directly configured interpreter
 * (ROBOTIC_STUDIO_PYTHON) or `uv run --project <projectPath> --extra <extra> --locked python`.
 */
export function resolvePythonRunner(projectPath: string, extra: string): PythonRunner {
  const configuredPython = process.env.ROBOTIC_STUDIO_PYTHON?.trim();
  if (configuredPython) return { command: configuredPython, args: [] };
  return {
    command: process.env.ROBOTIC_STUDIO_UV?.trim() || 'uv',
    args: ['run', '--project', projectPath, '--extra', extra, '--locked', 'python'],
  };
}

/**
 * Resolves how to invoke the `obj2mjcf` console script: a directly configured binary
 * (ROBOTIC_STUDIO_OBJ2MJCF) or `uv run --project <projectPath> --extra obj2mjcf --locked obj2mjcf`.
 */
export function resolveObj2MjcfRunner(projectPath: string, simulationReady = false): PythonRunner {
  const configured = process.env.ROBOTIC_STUDIO_OBJ2MJCF?.trim();
  if (configured) return { command: configured, args: [] };
  return {
    command: process.env.ROBOTIC_STUDIO_UV?.trim() || 'uv',
    args: [
      'run',
      '--project',
      projectPath,
      '--extra',
      'obj2mjcf',
      '--locked',
      ...(simulationReady ? ['python', '-m', 'robotic_studio.obj2mjcf'] : ['obj2mjcf']),
    ],
  };
}

/**
 * Resolves how to invoke the `glb2obj` conversion script: a directly configured interpreter
 * (ROBOTIC_STUDIO_GLB2OBJ_PYTHON) or `uv run --project <projectPath> --locked python`.
 */
export function resolveGlb2ObjRunner(projectPath: string): PythonRunner {
  const configured = process.env.ROBOTIC_STUDIO_GLB2OBJ_PYTHON?.trim();
  if (configured) return { command: configured, args: [] };
  return {
    command: process.env.ROBOTIC_STUDIO_UV?.trim() || 'uv',
    args: ['run', '--project', projectPath, '--locked', 'python'],
  };
}

export interface ProcessCleanupGuard {
  installed: boolean;
  shutdownPromise: Promise<void> | null;
}

export interface ProcessOperationQueue {
  starting: boolean;
  operationChain: Promise<void>;
}

/** Serializes worker lifecycle changes, reserving an exclusive start before queued work can yield. */
export function reserveWorkerStart<T>(
  queue: ProcessOperationQueue,
  conflict: () => Error,
  operation: () => Promise<T>,
): Promise<T> {
  if (queue.starting) return Promise.reject(conflict());
  queue.starting = true;
  return serializeWorkerOperation(queue, operation).finally(() => {
    queue.starting = false;
  });
}

export function serializeWorkerOperation<T>(
  queue: ProcessOperationQueue,
  operation: () => Promise<T>,
): Promise<T> {
  const result = queue.operationChain.then(operation, operation);
  queue.operationChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Stops only stale workers whose PID and command line both match the persisted marker. */
export async function recoverMarkedWorkerProcesses(
  root: string,
  moduleName: string,
  timeoutMs = 3_000,
  pollIntervalMs = 50,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const markerPath = path.join(root, entry.name, 'process.json');
    try {
      const marker = JSON.parse(await readFile(markerPath, 'utf8')) as {
        pid?: unknown;
        sessionId?: unknown;
      };
      if (
        typeof marker.pid !== 'number' ||
        !Number.isSafeInteger(marker.pid) ||
        marker.pid < 1 ||
        typeof marker.sessionId !== 'string' ||
        !marker.sessionId
      ) {
        await unlink(markerPath).catch(() => undefined);
        continue;
      }
      const commandLine = await readFile(`/proc/${marker.pid}/cmdline`, 'utf8').catch(() => '');
      if (commandLine.includes(moduleName) && commandLine.includes(marker.sessionId)) {
        try {
          process.kill(marker.pid, 'SIGTERM');
        } catch {
          // The process may have exited between inspection and signaling.
        }
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const current = await readFile(`/proc/${marker.pid}/cmdline`, 'utf8').catch(() => '');
          if (!current.includes(moduleName) || !current.includes(marker.sessionId)) break;
          await new Promise<void>((resolve) => setTimeout(() => resolve(), pollIntervalMs));
        }
        const remaining = await readFile(`/proc/${marker.pid}/cmdline`, 'utf8').catch(() => '');
        if (remaining.includes(moduleName) && remaining.includes(marker.sessionId)) {
          try {
            process.kill(marker.pid, 'SIGKILL');
          } catch {
            // The process may have exited between the final inspection and signal.
          }
        }
      }
      await unlink(markerPath).catch(() => undefined);
    } catch {
      await unlink(markerPath).catch(() => undefined);
    }
  }
}

/**
 * Deletes per-session directories under `root` that no tracked session owns. Call it only after
 * `recoverMarkedWorkerProcesses`, so no orphaned worker is still reading from them.
 */
export async function removeUntrackedSessionDirectories(
  root: string,
  trackedDirectories: Iterable<string>,
): Promise<void> {
  const tracked = new Set(Array.from(trackedDirectories, (directory) => path.resolve(directory)));
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.resolve(root, entry.name);
    if (tracked.has(directory)) continue;
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Registers a one-shot SIGINT/SIGTERM handler that stops every process tracked by the
 * caller's own registry before the Next.js server process exits. Each feature (evaluation
 * policy workers, teleoperation sessions) owns its own guard and `stopAll` so the two
 * process registries stay independent.
 */
export function installShutdownHandler(
  guard: ProcessCleanupGuard,
  stopAll: () => Promise<void>,
): void {
  if (process.env.NODE_ENV === 'test' || guard.installed) return;
  guard.installed = true;
  const shutdown = (exitCode: number) => {
    if (guard.shutdownPromise) return;
    guard.shutdownPromise = stopAll().finally(() => {
      process.exitCode = exitCode;
      process.exit();
    });
  };
  process.once('SIGINT', () => shutdown(130));
  process.once('SIGTERM', () => shutdown(143));
}

/**
 * Waits for a spawned child process to exit on its own (via `exited`, defaulting to the
 * process's own 'exit' event) and force-kills it with SIGKILL if it hasn't exited within
 * `timeoutMs`. Callers remain responsible for sending the initial SIGTERM.
 */
export async function waitForExitOrForceKill(
  child: ChildProcess,
  options: { timeoutMs: number; exited?: Promise<void>; onTimeout?: () => void },
): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      options.onTimeout?.();
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve();
    }, options.timeoutMs);
    timer.unref?.();
    const exited = options.exited ?? new Promise<void>((res) => child.once('exit', () => res()));
    exited.then(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    });
  });
}

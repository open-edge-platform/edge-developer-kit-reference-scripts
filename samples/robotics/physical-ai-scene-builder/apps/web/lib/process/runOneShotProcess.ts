// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process';

import { pythonWorkerEnvironment } from './pythonWorkerProcess';

export interface OneShotProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a short-lived command to completion and collects its output; never left running. */
export function runOneShotProcess(
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    signal?: AbortSignal;
    /** Called with each stdout/stderr line as it arrives, for live progress UIs. */
    onOutput?: (stream: 'stdout' | 'stderr', line: string) => void;
  } = { cwd: process.cwd() },
): Promise<OneShotProcessResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason);
      return;
    }
    const child = spawn(/* turbopackIgnore: true */ command, args, {
      cwd: options.cwd,
      env: options.env ?? pythonWorkerEnvironment(),
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const kill = () => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) reject(error);
      }
    };
    const abort = () => kill();
    options.signal?.addEventListener('abort', abort, { once: true });
    const forward = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (stream === 'stdout') stdout = (stdout + text).slice(-1_000_000);
      else stderr = (stderr + text).slice(-1_000_000);
      if (options.onOutput) {
        for (const line of text.split(/\r?\n/)) {
          if (line) options.onOutput(stream, line);
        }
      }
    };
    child.stdout?.on('data', (chunk: Buffer) => forward('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => forward('stderr', chunk));

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          kill();
        }, options.timeoutMs)
      : null;

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
    };
    child.on('error', (error) => {
      cleanup();
      reject(error);
    });
    child.on('close', (code) => {
      cleanup();
      if (options.signal?.aborted) {
        reject(options.signal.reason);
        return;
      }
      if (timedOut) {
        reject(new Error(`${command} exceeded its ${options.timeoutMs} ms conversion timeout.`));
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}

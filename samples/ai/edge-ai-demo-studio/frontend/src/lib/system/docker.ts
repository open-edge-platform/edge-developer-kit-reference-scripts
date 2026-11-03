// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { runCommand } from '@/lib/system/spawn'

const DOCKER_MISSING_MESSAGE =
  'Docker is not installed or not on PATH. Install Docker Desktop (Windows/macOS) or Docker Engine (Linux), make sure the daemon is running, and verify that the `docker` command works in your terminal before starting this service.'

const DOCKER_DAEMON_MESSAGE =
  'Docker is installed but the daemon is not reachable. Start Docker Desktop (or run `sudo systemctl start docker` on Linux) and try again.'

/** Whether `docker <args>` runs and exits 0 within `timeoutMs`. */
async function dockerSucceeds(
  args: string[],
  timeoutMs: number,
): Promise<boolean> {
  try {
    return (await runCommand('docker', args, { timeoutMs })).exitCode === 0
  } catch {
    return false
  }
}

/** Throws a message for the user unless the docker CLI and daemon both work. */
export async function assertDockerAvailable(): Promise<void> {
  if (!(await dockerSucceeds(['--version'], 5_000))) {
    throw new Error(DOCKER_MISSING_MESSAGE)
  }
  // `docker info` requires the daemon to be running, unlike `--version`.
  if (!(await dockerSucceeds(['info'], 10_000))) {
    throw new Error(DOCKER_DAEMON_MESSAGE)
  }
}

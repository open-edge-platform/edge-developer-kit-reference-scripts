// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const DOCKER_MISSING_MESSAGE =
  'Docker is not installed or not on PATH. Install Docker Desktop (Windows/macOS) or Docker Engine (Linux), make sure the daemon is running, and verify that the `docker` command works in your terminal before starting this service.'

const DOCKER_DAEMON_MESSAGE =
  'Docker is installed but the daemon is not reachable. Start Docker Desktop (or run `sudo systemctl start docker` on Linux) and try again.'

export async function assertDockerAvailable(): Promise<void> {
  try {
    await execFileAsync('docker', ['--version'], { timeout: 5_000 })
  } catch {
    throw new Error(DOCKER_MISSING_MESSAGE)
  }

  try {
    // `docker info` requires the daemon to be running, unlike `--version`.
    await execFileAsync('docker', ['info'], { timeout: 10_000 })
  } catch {
    throw new Error(DOCKER_DAEMON_MESSAGE)
  }
}

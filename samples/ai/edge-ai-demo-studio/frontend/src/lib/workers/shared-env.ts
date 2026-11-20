// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * The uv workspace's workers share one Python environment, `workers/.venv`, and each installs its
 * own packages into it on its first start. Python finds a package's code and its metadata
 * separately, so a process importing while another worker's install writes a package can see the
 * code without the metadata and fail: multiserve's FastAPI found `email_validator` half-written by
 * lipsync's install and crashed. So the app installs a worker's missing packages itself, alone,
 * before starting it, and holds its start until it is up (`shared-env-gate.ts`); the start script's
 * own install then finds nothing to do. Workers with their own `uv.lock` have their own venv.
 */

import fs from 'node:fs'
import path from 'node:path'
import { UV_PATH, WORKER_DIR } from '@/lib/constants'
import { globalSingleton } from '@/lib/global-singleton'
import { runCommand } from '@/lib/system/spawn'
import {
  createSharedEnvGate,
  type Release,
} from '@/lib/workers/shared-env-gate'

export type { Release } from '@/lib/workers/shared-env-gate'

/** Long enough for any worker's imports; a start still downloading its model holds no longer. */
const MAX_START_HOLD_MS = 5 * 60_000

/** `uv sync --check` is about 0.1 s, but waits while another install holds the environment. */
const CHECK_TIMEOUT_MS = 60_000

// On `globalThis`: hooks, routes and engines start workers from separate bundles in dev.
const gate = globalSingleton('sharedEnvGate', () =>
  createSharedEnvGate({ maxStartMs: MAX_START_HOLD_MS }),
)

/** Why an install the app ran for a worker failed; its output is in the worker's log. */
class SharedEnvInstallError extends Error {
  constructor() {
    super('Could not install the worker dependencies (uv sync failed)')
    this.name = 'SharedEnvInstallError'
  }
}

/**
 * The workspace package the worker in `workerDir` installs into `workers/.venv`, or null when it
 * has its own `uv.lock` (and venv) or is no Python project. Same rule as `Sync-Worker`.
 */
function sharedEnvPackage(workerDir: string): string | null {
  const relative = path.relative(WORKER_DIR, workerDir)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null
  }
  if (fs.existsSync(path.join(workerDir, 'uv.lock'))) return null
  let pyproject: string
  try {
    pyproject = fs.readFileSync(path.join(workerDir, 'pyproject.toml'), 'utf8')
  } catch {
    return null
  }
  return /^name\s*=\s*"([^"]+)"/m.exec(pyproject)?.[1] ?? null
}

/** The start scripts' install (`Sync-Worker` in `workers/scripts/worker-common.*`). */
const syncArgs = (pkg: string) => [
  'sync',
  '--frozen',
  '--inexact',
  '--project',
  WORKER_DIR,
  '--package',
  pkg,
]

/** Whether `workers/.venv` already holds everything `pkg` needs; read-only. */
async function isInstalled(pkg: string): Promise<boolean> {
  try {
    const { exitCode } = await runCommand(
      UV_PATH,
      [...syncArgs(pkg), '--check'],
      { timeoutMs: CHECK_TIMEOUT_MS },
    )
    return exitCode === 0
  } catch {
    // Unknown: install, which changes nothing when it is all there.
    return false
  }
}

export interface SharedEnvSteps {
  /** A line for the worker's log. */
  log: (type: 'out' | 'error', line: string) => void
  /** A step for its startup panel. */
  step: (detail: string) => void
}

/**
 * Readies `workers/.venv` for the worker in `workerDir` and holds its start: installs what it lacks
 * (alone), then waits for any install asked for before. The returned release ends the hold, once
 * the worker is up or gone; null when the worker does not run from `workers/.venv`. Throws
 * `SharedEnvInstallError`, or `signal`'s reason when aborted while waiting. An install already
 * running is not interrupted: stopping it halfway would leave packages half-written.
 */
export async function prepareSharedEnv(
  workerDir: string,
  { signal, log, step }: SharedEnvSteps & { signal: AbortSignal },
): Promise<Release | null> {
  const pkg = sharedEnvPackage(workerDir)
  // Without uv the start script reports the missing setup itself.
  if (!pkg || !fs.existsSync(UV_PATH)) return null

  if (!(await isInstalled(pkg))) {
    const release = await gate.install(signal, () =>
      step('Waiting for other services before installing dependencies'),
    )
    try {
      step('Installing dependencies')
      log('out', `Installing the dependencies of ${pkg} into workers/.venv...`)
      const { exitCode, stderr } = await runCommand(UV_PATH, syncArgs(pkg), {
        timeoutMs: null,
        onLine: (line) => {
          if (line.trim()) log('out', line)
        },
      })
      if (exitCode !== 0) {
        const cause = stderr.trim().split(/\r?\n/).pop()
        log('error', `uv sync exited with code ${exitCode}: ${cause ?? ''}`)
        throw new SharedEnvInstallError()
      }
    } finally {
      release()
    }
  }

  return gate.start(signal, () =>
    step('Waiting for another service to finish installing'),
  )
}

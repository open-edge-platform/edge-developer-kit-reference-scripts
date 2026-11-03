// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import { LOGS_DIR, MODELS_DIR, WORKER_DIR } from '@/lib/constants'
import type { Service } from '@/payload-types'

/** Server-only: where the multiserve engine lives, logs and keeps models. */

export const MULTISERVE_REPO_PATH = path.join(WORKER_DIR, 'engines/multiserve')

const MULTISERVE_MODELS_DIR = path.join(MODELS_DIR, 'multiserve')
const MULTISERVE_LOGS_DIR = path.join(LOGS_DIR, 'multiserve')

/** The models directory, shared by every instance of a service type. */
export function getModelsDir(type?: Service['type']): string {
  return type ? path.join(MULTISERVE_MODELS_DIR, type) : MULTISERVE_MODELS_DIR
}

/** The type's log directory; each instance logs into a sub-folder of it. */
export function getLogsDir(type?: Service['type']): string {
  return type ? path.join(MULTISERVE_LOGS_DIR, type) : MULTISERVE_LOGS_DIR
}

export function getInstanceLogsDir(
  instance: Pick<Service, 'type' | 'instanceId'>,
): string {
  return path.join(getLogsDir(instance.type), instance.instanceId)
}

/** What a model server logs to: `ovms_server.log`, `<task>_server.log`. */
const SERVER_LOG = /_server\.log$/

/**
 * An instance's model server log (earlier runs' with `previous`), or null before any. Each server
 * truncates its log as it starts, so the newest is the current one; others are left from earlier
 * models (as `determine_log_file_name` in the engine's log router picks).
 */
export async function getLogFile(
  instance: Pick<Service, 'type' | 'instanceId'>,
  previous: boolean,
): Promise<string | null> {
  const dir = getInstanceLogsDir(instance)
  const base = previous ? path.join(dir, 'old') : dir
  let names: string[]
  try {
    names = await fs.readdir(base)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  let newest: { file: string; modified: number } | null = null
  for (const name of names.filter((n) => SERVER_LOG.test(n))) {
    const file = path.join(base, name)
    // Gone since the listing (the instance was deleted, say).
    const stats = await fs.stat(file).catch(() => null)
    if (
      stats &&
      stats.isFile() &&
      (!newest || stats.mtimeMs > newest.modified)
    ) {
      newest = { file, modified: stats.mtimeMs }
    }
  }
  return newest?.file ?? null
}

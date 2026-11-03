// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Per-instance runtime contract for worker processes: env INSTANCE_ID, INSTANCE_KEY,
 * INSTANCE_DATA_DIR (its own dir, removed with the instance) and EDGE_AI_STUDIO_URL (to call
 * siblings via /api/<type>@<id>/), plus `--instance-id`/`--data-dir` args unless it opts out.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { BasePayload } from 'payload'
import { engineServers } from '@/engines/_generated/engines'
import { sleep } from '@/lib/async'
import { DATA_DIR, LOGS_DIR } from '@/lib/constants'
import { getInstanceKey, type InstanceRef } from '@/lib/instances/instances'
import { isTransientStatus } from '@/lib/instances/service-status'
import type { Service } from '@/payload-types'

function getInstanceDataDir(ref: InstanceRef): string {
  return path.join(DATA_DIR, ref.type, ref.instanceId)
}

export function ensureInstanceDataDir(ref: InstanceRef): string {
  const dir = getInstanceDataDir(ref)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Deletes a deleted instance's state. */
export function removeInstanceDataDir(ref: InstanceRef): void {
  fs.rmSync(getInstanceDataDir(ref), { recursive: true, force: true })
}

/** Moves `from` to `to` if it exists; an existing `to` is left untouched. */
function moveIfPresent(from: string, to: string): void {
  if (!fs.existsSync(from) || fs.existsSync(to)) return
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.renameSync(from, to)
}

/**
 * Migrates a legacy `default` instance (data dir `default`, studio log `<type>.log`, engine logs
 * loose in the engine's log folder) to `toId`'s places.
 */
export function moveLegacyDefaultArtifacts(
  service: Pick<Service, 'type' | 'engine'>,
  toId: string,
): void {
  const { type } = service
  moveIfPresent(
    path.join(DATA_DIR, type, 'default'),
    path.join(DATA_DIR, type, toId),
  )

  const toKey = getInstanceKey({ type, instanceId: toId })
  for (const dir of [LOGS_DIR, path.join(LOGS_DIR, 'old')]) {
    moveIfPresent(path.join(dir, `${type}.log`), path.join(dir, `${toKey}.log`))
  }

  const engine = service.engine ? engineServers[service.engine] : undefined
  if (!engine) return
  const base = engine.getLogsDir(type)
  if (!fs.existsSync(base)) return
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (entry.isFile()) {
      moveIfPresent(
        path.join(base, entry.name),
        path.join(base, toId, entry.name),
      )
    }
  }
}

/** Loopback base URL of this app, as seen from a worker on the same host. */
function getStudioBaseUrl(): string {
  return `http://127.0.0.1:${process.env.PORT ?? 3000}`
}

export function buildInstanceEnv(
  ref: InstanceRef,
  dataDir: string,
): Record<string, string> {
  return {
    INSTANCE_ID: ref.instanceId,
    INSTANCE_KEY: getInstanceKey(ref),
    INSTANCE_DATA_DIR: dataDir,
    EDGE_AI_STUDIO_URL: getStudioBaseUrl(),
  }
}

export function buildInstanceArgs(ref: InstanceRef, dataDir: string): string[] {
  return ['--instance-id', ref.instanceId, '--data-dir', dataDir]
}

/**
 * Resolves once a row leaves its transient start states, to start instances one at a time:
 * multiserve cannot initialise two instances of one type at once.
 */
export async function waitForInstanceToSettle(
  payload: BasePayload,
  id: number,
  timeoutMs = 5 * 60_000,
  intervalMs = 2_000,
): Promise<Service['status']> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const row = await payload.findByID({
      collection: 'services',
      id,
      disableErrors: true,
    })
    // A row deleted while it started has nothing left to wait for.
    if (!row) return 'inactive'
    if (!isTransientStatus(row.status)) return row.status
    await sleep(intervalMs)
  }
  return 'prepare'
}

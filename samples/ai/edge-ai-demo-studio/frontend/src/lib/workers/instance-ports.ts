// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type BasePayload, NotFound } from 'payload'
import { engines } from '@/engines/registry'
import { ApiError } from '@/lib/api/errors'
import { globalSingleton } from '@/lib/global-singleton'
import { isServiceType } from '@/lib/instances/service-type'
import { canBind } from '@/lib/system/can-bind'
import type { Service } from '@/payload-types'
import { metaMap } from '@/services/_generated/meta'
import {
  DRAFT_ENGINE_INSTANCE_ID,
  INSTANCE_PORT_RANGE,
  getInstanceLabel,
  getInstancePortBlock,
  isValidInstanceId,
  parseInstanceKey,
} from '@/lib/instances/instances'
import { logger } from '@/lib/logger'

/**
 * Dynamic port allocation: a starting instance gets the first free port block in the range, stored
 * on its row until it stops. Clients only see the `/api/<type>@<instanceId>/*` proxy, which looks
 * the port up here. The range can be overridden with env `INSTANCE_PORT_RANGE=8100-8199`.
 */

export interface PortRange {
  start: number
  end: number
}

function getInstancePortRange(): PortRange {
  const raw = process.env.INSTANCE_PORT_RANGE?.trim()
  if (raw) {
    const match = raw.match(/^(\d{2,5})\s*-\s*(\d{2,5})$/)
    if (match) {
      const start = Number(match[1])
      const end = Number(match[2])
      if (start >= 1024 && end <= 65535 && end > start) {
        return { start, end }
      }
    }
    logger.warn(
      `INSTANCE_PORT_RANGE "${raw}" is invalid (expected e.g. 8100-8199) — using the default range`,
    )
  }
  return { ...INSTANCE_PORT_RANGE }
}

export function isInstancePort(port: number): boolean {
  const { start, end } = getInstancePortRange()
  return port >= start && port <= end
}

/**
 * Ports a service needs after its base port: the engine's `getSubPorts`, else the worker's
 * `portBlock` from `data.ts` (e.g. a docker suite's http, https and rtsp ports).
 */
function getSubPortsFor(
  engine: string | null | undefined,
  type: string | null | undefined,
  basePort: number,
): number[] {
  const eng = engine ? engines[engine] : undefined
  if (eng?.getSubPorts) return eng.getSubPorts(basePort)
  const block = isServiceType(type) ? (metaMap[type].portBlock ?? 1) : 1
  return Array.from(
    { length: Math.max(0, block - 1) },
    (_, i) => basePort + 1 + i,
  )
}

/** Every port a `services` row currently occupies (base + sub-ports). */
export function getPortsOfRow(row: {
  port?: number | null
  engine?: string | null
  type?: string | null
}): number[] {
  if (row.port == null) return []
  return getInstancePortBlock(
    row.port,
    getSubPortsFor(row.engine, row.type, row.port),
  )
}

/** Fixed ports some workers use internally (e.g. an embedded OVMS). */
export function getReservedPorts(): Set<number> {
  const ports = new Set<number>()
  for (const meta of Object.values(metaMap)) {
    for (const p of meta.reservedPorts ?? []) ports.add(p)
  }
  return ports
}

class InstancePortExhaustedError extends ApiError {
  constructor(range: PortRange) {
    super(
      409,
      `No free port left in the service port range ${range.start}–${range.end}. Stop another service or widen INSTANCE_PORT_RANGE.`,
    )
    this.name = 'InstancePortExhaustedError'
  }
}

/**
 * Allocation is read-then-write, so two starts in one tick would pick the same port: every
 * allocation runs through this queue. On `globalThis` because dev bundles the hooks and the
 * engine route separately, each with its own copy of this module.
 */
const allocationQueue = globalSingleton(
  'instancePortAllocation',
  (): { tail: Promise<unknown> } => ({ tail: Promise.resolve() }),
)
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = allocationQueue.tail.then(fn, fn)
  allocationQueue.tail = run.catch(() => undefined)
  return run
}

/**
 * Ports held by a process without a `services` row (a draft engine), by instance key. Proxy
 * lookups bump `lastUsed` so the owner can stop a process nobody talks to.
 */
interface RowlessPortBlock {
  port: number
  ports: number[]
  lastUsed: number
}

const rowlessPortBlocks = globalSingleton(
  'rowlessPortBlocks',
  () => new Map<string, RowlessPortBlock>(),
)

/** The first base port whose whole block is unused by other rows, not reserved, and bindable now. */
async function allocateInstancePortUnlocked(
  payload: BasePayload,
  options: {
    engine: string | null | undefined
    type: string
    excludeRowId?: number
  },
): Promise<number> {
  const range = getInstancePortRange()
  const rows = await payload.find({
    collection: 'services',
    pagination: false,
  })
  const used = getReservedPorts()
  for (const row of rows.docs) {
    if (row.id === options.excludeRowId) continue
    for (const p of getPortsOfRow(row)) used.add(p)
  }
  for (const block of rowlessPortBlocks.values()) {
    for (const p of block.ports) used.add(p)
  }

  for (let base = range.start; base <= range.end; base++) {
    const block = getInstancePortBlock(
      base,
      getSubPortsFor(options.engine, options.type, base),
    )
    if (block.some((p) => p > range.end)) break
    if (block.some((p) => used.has(p))) continue

    const bindable = await Promise.all(block.map((p) => canBind(p)))
    if (bindable.every(Boolean)) return base

    logger.log(
      `Port ${base} (with sub-ports ${block.slice(1).join(', ') || 'none'}) is bound by another process, trying the next one`,
    )
  }

  throw new InstancePortExhaustedError(range)
}

/**
 * Ensures a row has a port before it starts, allocating and storing one if needed. Re-reads the row
 * because a hook's `service.port` can predate a stop that freed it for another instance.
 */
export function ensureInstancePort(
  payload: BasePayload,
  service: Service,
): Promise<Service> {
  // Choose and record the port inside one critical section, so the next
  // allocation sees this row's port.
  return serialized(async () => {
    const current = await payload.findByID({
      collection: 'services',
      id: service.id,
      disableErrors: true,
    })
    const stored = current ? current.port : service.port
    if (stored != null) return { ...service, port: stored }

    const port = await allocateInstancePortUnlocked(payload, {
      engine: service.engine,
      type: service.type,
      excludeRowId: service.id,
    })
    const updated = await payload.update({
      collection: 'services',
      id: service.id,
      data: { port },
    })
    invalidateInstancePortCache()
    logger.log(
      `🔌 ${service.type}@${service.instanceId}: allocated port ${port}`,
    )
    return updated
  })
}

/** Allocates (or returns the held) port block for a process with no `services` row. */
export function ensureRowlessPort(
  payload: BasePayload,
  key: string,
  options: { engine: string; type: string },
): Promise<number> {
  return serialized(async () => {
    const held = rowlessPortBlocks.get(key)
    if (held) return held.port
    const port = await allocateInstancePortUnlocked(payload, options)
    rowlessPortBlocks.set(key, {
      port,
      ports: getInstancePortBlock(
        port,
        getSubPortsFor(options.engine, options.type, port),
      ),
      lastUsed: Date.now(),
    })
    logger.log(`🔌 ${key}: allocated port ${port}`)
    return port
  })
}

/** The port a row-less process holds, if any, and when it was last proxied. */
export function getRowlessPort(
  key: string,
): { port: number; lastUsed: number } | undefined {
  const block = rowlessPortBlocks.get(key)
  return block && { port: block.port, lastUsed: block.lastUsed }
}

export function releaseRowlessPort(key: string): void {
  const block = rowlessPortBlocks.get(key)
  if (!block) return
  rowlessPortBlocks.delete(key)
  logger.log(`🔌 ${key}: released port ${block.port}`)
}

/**
 * Frees a stopped service's port. With `whileStatus`, only while the row still has that status, so a
 * start that came in meanwhile keeps it (the shared queue orders the two).
 */
export function releaseInstancePort(
  payload: BasePayload,
  service: Service,
  whileStatus?: Service['status'],
): Promise<void> {
  return serialized(async () => {
    const current = await payload.findByID({
      collection: 'services',
      id: service.id,
      disableErrors: true,
    })
    // Deleted while it stopped: the row took its port with it.
    if (current?.port == null) return
    if (whileStatus && current.status !== whileStatus) return
    try {
      await payload.update({
        collection: 'services',
        id: service.id,
        data: { port: null },
      })
    } catch (error) {
      if (!(error instanceof NotFound)) throw error
    }
    invalidateInstancePortCache()
    logger.log(
      `🔌 ${service.type}@${service.instanceId}: released port ${current.port}`,
    )
  })
}

// Port lookup for the proxy

export type ResolvedInstancePort =
  | { port: number }
  | { error: 'unknown'; type: string; instanceId: string | null }
  | { error: 'stopped'; type: string; instanceId: string; label: string }

const PORT_CACHE_TTL_MS = 3_000

const portCache = globalSingleton(
  'instancePortCache',
  () => new Map<string, { value: ResolvedInstancePort; ts: number }>(),
)

/** Call after any `services` row changes so proxies pick the new port up. */
export function invalidateInstancePortCache(): void {
  portCache.clear()
}

/**
 * The current port for `type@instanceId` (a bare `type` is `unknown`). Cached briefly; the services
 * hooks invalidate the cache on every row change.
 */
export async function resolveInstancePort(
  payload: BasePayload,
  instanceKey: string,
): Promise<ResolvedInstancePort> {
  const cached = portCache.get(instanceKey)
  if (cached && Date.now() - cached.ts < PORT_CACHE_TTL_MS) return cached.value

  const parsed = parseInstanceKey(instanceKey)
  if (!parsed) return { error: 'unknown', type: instanceKey, instanceId: null }
  const { type, instanceId } = parsed
  const unknown: ResolvedInstancePort = { error: 'unknown', type, instanceId }
  if (!isServiceType(type)) return unknown

  // A draft engine has no row; its port lives only in memory, and every
  // lookup is a use that keeps it from being stopped as idle.
  if (instanceId === DRAFT_ENGINE_INSTANCE_ID) {
    const block = rowlessPortBlocks.get(instanceKey)
    if (!block) {
      return { error: 'stopped', type, instanceId, label: 'draft engine' }
    }
    block.lastUsed = Date.now()
    return { port: block.port }
  }

  if (!isValidInstanceId(instanceId)) return unknown

  const found = await payload.find({
    collection: 'services',
    where: {
      and: [{ type: { equals: type } }, { instanceId: { equals: instanceId } }],
    },
    limit: 1,
  })
  const row = found.docs[0]
  const value: ResolvedInstancePort = !row
    ? unknown
    : typeof row.port === 'number'
      ? { port: row.port }
      : {
          error: 'stopped',
          type,
          instanceId,
          label: getInstanceLabel(row),
        }

  portCache.set(instanceKey, { value, ts: Date.now() })
  return value
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import config from '@payload-config'
import type { NextRequest } from 'next/server'
import { getPayload } from 'payload'
import { jsonError } from '@/lib/api/json'
import { getInstanceKey } from '@/lib/instances/instances'
import { isServiceType } from '@/lib/instances/service-type'
import { logger } from '@/lib/logger'
import { APP_SETTINGS_DEFAULTS } from '@/lib/settings/app-settings'
import { readAppSettingsSafe } from '@/lib/settings/app-settings-store'
import { resolveInstancePort } from '@/lib/workers/instance-ports'
import { invalidateModelCatalog } from '@/lib/workers/model-catalog'
import { answeredByOtherInstance, fetchLoopback } from '@/lib/workers/loopback'
import { createStallWatchdog } from '@/lib/workers/stall-watchdog'
import {
  untimedDispatcher,
  type WorkerRequestInit,
} from '@/lib/workers/untimed-dispatcher'
import { metaMap } from '@/services/_generated/meta'

export const dynamic = 'force-dynamic'

/**
 * Proxy for every service worker: `/api/<type>@<instanceId>/<path>` is rewritten here
 * (next.config.ts) and streamed to the instance's current port. Stopped or refusing: 503; unknown:
 * 404; port answered by another instance: 502. A bare `/api/<type>/<path>` only gets a 404 listing
 * the valid addresses.
 */

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  // curl asks for `100 Continue` before an upload; the app already answered
  // that hop, and Node's fetch refuses a request carrying it.
  'expect',
])

async function getProxyTimeoutMs(): Promise<number> {
  const settings = await readAppSettingsSafe()
  return (settings.proxyTimeout ?? APP_SETTINGS_DEFAULTS.proxyTimeout) * 1000
}

/**
 * `/api/<type>` is not an address: every instance is reached at
 * `/api/<type>@<instanceId>`. Names the ones that exist.
 */
async function bareAddressResponse(
  payload: Awaited<ReturnType<typeof getPayload>>,
  type: string,
) {
  const rows = isServiceType(type)
    ? await payload.find({
        collection: 'services',
        where: { type: { equals: type } },
        limit: 100,
      })
    : undefined
  const addresses = (rows?.docs ?? []).map(
    (row) => `/api/${getInstanceKey(row)}`,
  )
  return jsonError(
    404,
    `"/api/${type}" is not a service address. Call an instance at /api/${type}@<instance>.`,
    addresses.length > 0 ? { addresses } : undefined,
  )
}

/**
 * A call that adds or removes models on disk (a download, an upload, a
 * delete): the on-disk catalogue of the instance's type is stale after it.
 */
function changesModels(method: string, path: string[]): boolean {
  return (
    method !== 'GET' &&
    method !== 'HEAD' &&
    path.some((segment) => segment === 'model' || segment === 'models')
  )
}

/** A `fetch` that failed because nothing accepted the connection. */
function isConnectionRefused(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    (error.cause as { code?: unknown } | undefined)?.code === 'ECONNREFUSED'
  )
}

async function proxy(
  req: NextRequest,
  { params }: { params: Promise<{ instance: string; path: string[] }> },
) {
  const { instance, path } = await params
  const payload = await getPayload({ config })
  const resolved = await resolveInstancePort(payload, instance)

  if ('error' in resolved) {
    if (resolved.error === 'unknown') {
      return resolved.instanceId === null
        ? bareAddressResponse(payload, resolved.type)
        : jsonError(404, `Unknown service instance "${instance}"`)
    }
    const name = isServiceType(resolved.type)
      ? metaMap[resolved.type].name
      : resolved.type
    return jsonError(
      503,
      `${name} (${resolved.label}) is not running. Start it from the Services page.`,
    )
  }

  const { port } = resolved
  const incoming = new URL(req.url)
  const segments = path ?? []
  const targetPath = segments.map(encodeURIComponent).join('/')
  // The URL parser leaves these raw in a query; pass them on encoded.
  const search = incoming.search.replace(/[\\^`{|}]/g, encodeURIComponent)

  const headers = new Headers()
  req.headers.forEach((value, key) => {
    const k = key.toLowerCase()
    if (!HOP_BY_HOP.has(k)) {
      headers.set(key, value)
    }
  })

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  // The proxy timeout bounds the worker's silence, not the whole call. A client that goes away
  // (even before the answer starts) cancels the upstream call.
  const timeoutMs = await getProxyTimeoutMs()
  const watchdog = createStallWatchdog({
    timeoutMs,
    stalledError: () =>
      new Error(`The worker sent nothing for ${timeoutMs / 1000} s`),
    clientSignal: req.signal,
  })
  const type = instance.slice(0, instance.indexOf('@'))
  const onModelsChanged = changesModels(req.method, segments)
    ? () => invalidateModelCatalog(type)
    : undefined

  try {
    const init: WorkerRequestInit = {
      method: req.method,
      headers,
      body: hasBody && req.body ? watchdog.watch(req.body) : undefined,
      // Required by Node's fetch when streaming a request body.
      duplex: 'half',
      dispatcher: untimedDispatcher,
      signal: watchdog.signal,
      redirect: 'manual',
    }
    const upstream = await fetchLoopback(port, `/${targetPath}${search}`, init)
    watchdog.touch()

    const other = answeredByOtherInstance(upstream, instance)
    if (other) {
      watchdog.stop()
      await upstream.body?.cancel()
      logger.error(
        `Proxy to instance "${instance}": port ${port} is answered by ${other}`,
      )
      return jsonError(
        502,
        `Port ${port} of ${instance} is answered by ${other}, not by ${instance}. Restart ${instance}.`,
      )
    }

    const responseHeaders = new Headers()
    upstream.headers.forEach((value, key) => {
      const k = key.toLowerCase()
      // fetch already decoded the body; drop the encoding/length headers
      if (HOP_BY_HOP.has(k) || k === 'content-encoding') return
      responseHeaders.set(key, value)
    })

    if (!upstream.body) {
      watchdog.stop()
      onModelsChanged?.()
    }
    return new Response(
      upstream.body &&
        watchdog.watch(upstream.body, {
          endsCall: true,
          onEnd: onModelsChanged,
        }),
      {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      },
    )
  } catch (error) {
    watchdog.stop()
    // Nothing listens on the port yet, or any more: the instance is starting
    // or stopping (its health poller reports one that died).
    if (isConnectionRefused(error)) {
      logger.log(`Proxy to instance "${instance}": port ${port} refused`)
      return jsonError(
        503,
        `${instance} is not accepting connections on port ${port} yet. It may still be starting.`,
      )
    }
    logger.error(`Proxy to instance "${instance}" failed:`, error)
    return watchdog.stalled
      ? jsonError(
          504,
          `Request to ${instance} timed out: it sent nothing for ${timeoutMs / 1000} s. The task may be too large or the service busy — try again, or raise the proxy timeout in Settings.`,
        )
      : jsonError(502, `Instance ${instance} is not reachable on port ${port}`)
  }
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
export const OPTIONS = proxy
export const HEAD = proxy

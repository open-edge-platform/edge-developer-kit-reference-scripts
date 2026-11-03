// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ZipArchive, type EntryData, type ZipEntryData } from 'archiver'
import { randomUUID } from 'node:crypto'
import { finished, Readable } from 'node:stream'
import {
  cleanupBundle,
  type ExportBundle,
} from '@/lib/deployment/export-bundle'
import { globalSingleton } from '@/lib/global-singleton'
import { logger } from '@/lib/logger'

/**
 * Finished exports, by id, so the export (streamed as progress) and the zip download are separate
 * requests, and the zip can be re-downloaded until `DOWNLOAD_TTL_MS` after the export finished.
 */

const DOWNLOAD_TTL_MS = 30 * 60_000

// Zlib's default level: on mostly source text, level 9 costs far more CPU for a few percent.
// Already-compressed files are stored as they are.
const ZIP_LEVEL = 6
const STORED_RE =
  /\.(png|jpe?g|gif|webp|avif|ico|mp3|mp4|webm|ogg|zip|gz|tgz|bz2|xz|7z|woff2?|onnx|pdf)$/i

const DOWNLOAD_ID_RE = /^[0-9a-f-]{36}$/

// How the stream ends when the browser drops the download part-way.
const CANCELLED_CODES = new Set(['ABORT_ERR', 'ERR_STREAM_PREMATURE_CLOSE'])

interface PendingDownload {
  bundle: ExportBundle
  fileName: string
  timer: NodeJS.Timeout
  /** Downloads of it in progress. */
  sending: number
  /** Past its time: removed once no download is being sent. */
  expired: boolean
}

// The export and download routes are separate bundles in dev, each with its own copy of this module.
const downloads = globalSingleton(
  'exportBundleDownloads',
  () => new Map<string, PendingDownload>(),
)

/** Keeps a finished bundle for `DOWNLOAD_TTL_MS`; returns its id and expiry (epoch ms). */
export function registerBundleDownload(
  bundle: ExportBundle,
  fileName: string,
): { id: string; expiresAt: number } {
  const id = randomUUID()
  const timer = setTimeout(() => expireDownload(id), DOWNLOAD_TTL_MS)
  timer.unref?.()
  downloads.set(id, { bundle, fileName, timer, sending: 0, expired: false })
  return { id, expiresAt: Date.now() + DOWNLOAD_TTL_MS }
}

function expireDownload(id: string) {
  const pending = downloads.get(id)
  if (!pending) return
  downloads.delete(id)
  if (pending.sending === 0) cleanupBundle(pending.bundle.tmpDir)
  else pending.expired = true
}

export function bundleDownloadPath(id: string): string {
  return `/api/export-bundle/download/${id}`
}

function registered(id: string): PendingDownload | undefined {
  return DOWNLOAD_ID_RE.test(id) ? downloads.get(id) : undefined
}

export function hasBundleDownload(id: string): boolean {
  return registered(id) !== undefined
}

/** A registered bundle as a zip download, or `undefined` once expired; it stays registered. */
export function bundleDownloadResponse(id: string): Response | undefined {
  const pending = registered(id)
  if (!pending) return undefined
  pending.sending += 1
  return zipResponse(pending.bundle, pending.fileName, () => {
    pending.sending -= 1
    if (pending.expired && pending.sending === 0) {
      cleanupBundle(pending.bundle.tmpDir)
    }
  })
}

/** An unregistered bundle as a zip download; its temp directory is removed when the response ends. */
export function bundleZipResponse(
  bundle: ExportBundle,
  fileName: string,
): Response {
  return zipResponse(bundle, fileName, () => void cleanupBundle(bundle.tmpDir))
}

/**
 * The bundle as a zip compressed while it streams, under one top-level folder named after the zip.
 * `onEnd` runs once the response ends, fails or is cancelled.
 */
function zipResponse(
  { outDir }: ExportBundle,
  fileName: string,
  onEnd: () => void,
): Response {
  const rootDir = fileName.replace(/\.zip$/, '')
  const archive = new ZipArchive({ zlib: { level: ZIP_LEVEL } })
  archive.on('warning', (warn) => logger.warn(`zip warning: ${warn}`))
  finished(archive, (err) => {
    if (err) {
      // A cancelled download stops reading files before they are removed.
      archive.abort()
      if (!CANCELLED_CODES.has(err.code ?? '')) {
        logger.error('Export zip failed:', err)
      }
    }
    onEnd()
  })
  archive.directory(outDir, rootDir, (entry: EntryData): ZipEntryData => ({
    ...entry,
    store: STORED_RE.test(entry.name),
  }))
  archive.finalize().catch(() => {
    // Reported through the stream's own error above.
  })

  return new Response(
    Readable.toWeb(archive) as unknown as ReadableStream<Uint8Array>,
    {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  )
}

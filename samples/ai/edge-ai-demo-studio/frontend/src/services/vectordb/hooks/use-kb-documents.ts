// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import { isHttpError } from '@/lib/browser/fetch-json'
import { getErrorMessage } from '@/lib/errors'
import type { Chunk } from '../types'
import {
  useDeleteChunks,
  useDeleteFile,
  useKbChunks,
  useKbFiles,
  useUploadFile,
} from './index'

/** The document types the worker takes (`POST /v1/kb/{id}/files`). */
export const DOCUMENT_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.html',
  '.txt',
  '.csv',
  '.json',
] as const

/**
 * Largest upload: the app proxy buffers at most this much of a body (`proxyClientMaxBodySize` in
 * next.config.ts), so a larger file would reach the worker cut short.
 */
export const MAX_DOCUMENT_BYTES = 500 * 1024 * 1024

/** A file left out of an upload, and why. */
export interface SkippedFile {
  name: string
  reason: string
}

/** Splits picked files into those the worker takes and those it would refuse. */
export function checkDocuments(files: File[]): {
  accepted: File[]
  skipped: SkippedFile[]
} {
  const accepted: File[] = []
  const skipped: SkippedFile[] = []
  for (const file of files) {
    const dot = file.name.lastIndexOf('.')
    const ext = dot > 0 ? file.name.slice(dot).toLowerCase() : ''
    if (!(DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)) {
      skipped.push({ name: file.name, reason: 'not a supported type' })
    } else if (file.size > MAX_DOCUMENT_BYTES) {
      skipped.push({
        name: file.name,
        reason: `larger than ${MAX_DOCUMENT_BYTES / 1024 ** 2} MB`,
      })
    } else {
      accepted.push(file)
    }
  }
  return { accepted, skipped }
}

/** Last path segment, so an absolute/relative chunk `source` matches a filename. */
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p

/** The names of the files some chunk was embedded from (their `source`). */
export function embeddedFileNames(chunks: Chunk[]): Set<string> {
  return new Set(
    chunks
      .map((c) => baseName(String(c.metadata?.source ?? '')))
      .filter(Boolean),
  )
}

/**
 * A knowledge base's documents and which are embedded, read off the chunks' `source` so embed runs
 * never duplicate a file. Re-uploading or removing a file drops its old chunks.
 */
export function useKbDocuments(apiBase: string | undefined, kbId: number) {
  const filesQuery = useKbFiles(apiBase, kbId)
  const chunksQuery = useKbChunks(apiBase, kbId)
  const { mutateAsync: uploadFile } = useUploadFile(apiBase)
  const { mutateAsync: deleteFile, isPending: isDeletingFile } =
    useDeleteFile(apiBase)
  const { mutateAsync: deleteChunks } = useDeleteChunks(apiBase)
  /** Uploads in flight, across drops. */
  const [uploading, setUploading] = useState(0)

  const files = filesQuery.data ?? []
  const chunks = chunksQuery.data?.chunks ?? []
  const embeddedNames = embeddedFileNames(chunks)
  const pendingFiles = files.filter((f) => !embeddedNames.has(f.name))

  const docIdsForFile = (filename: string) =>
    chunks
      .filter((c) => baseName(String(c.metadata?.source ?? '')) === filename)
      .map((c) => c.doc_id)

  /** Uploads one file; resolves with why it failed, or `null`. */
  const uploadOne = async (file: File): Promise<string | null> => {
    try {
      await uploadFile({ kbId, file })
    } catch (err) {
      return `Failed to upload ${file.name}: ${getErrorMessage(err, 'the worker did not take it')}`
    }
    // If a file with this name was already embedded, drop its stale
    // chunks so the re-uploaded version shows up as pending again.
    const stale = docIdsForFile(file.name)
    if (stale.length === 0) return null
    try {
      await deleteChunks({ kbId, docIds: stale })
      return null
    } catch (err) {
      return `${file.name} was uploaded, but its old chunks could not be removed: ${getErrorMessage(err)}`
    }
  }

  /** Uploads files side by side; `onError` hears once of every one that failed. */
  const upload = async (
    fileList: File[],
    onError: (message: string) => void,
  ) => {
    setUploading((n) => n + 1)
    try {
      const failures = (await Promise.all(fileList.map(uploadOne))).filter(
        (failure): failure is string => failure !== null,
      )
      if (failures.length > 0) onError(failures.join('; '))
    } finally {
      setUploading((n) => n - 1)
    }
  }

  /**
   * Removes a file and every chunk embedded from it, each on its own, so a
   * retry finishes what is left; rejects naming what could not be removed.
   */
  const removeFile = async (filename: string) => {
    const ids = docIdsForFile(filename)
    const [file, embedded] = await Promise.allSettled([
      deleteFile({ kbId, filename }),
      ids.length > 0 ? deleteChunks({ kbId, docIds: ids }) : null,
    ])
    const failures: string[] = []
    // Gone already (an earlier try removed it) is what was asked for.
    if (file.status === 'rejected' && !isHttpError(file.reason, 404)) {
      failures.push(`the file (${getErrorMessage(file.reason)})`)
    }
    if (embedded.status === 'rejected') {
      failures.push(`its chunks (${getErrorMessage(embedded.reason)})`)
    }
    if (failures.length > 0) {
      throw new Error(`Could not remove ${failures.join(' and ')}`)
    }
  }

  return {
    files,
    filesError: filesQuery.error,
    embeddedNames,
    pendingFiles,
    upload,
    isUploading: uploading > 0,
    removeFile,
    isRemoving: isDeletingFile,
  }
}

// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { toast } from 'sonner'
import { downloadUrl } from '@/lib/browser/download'
import { createExternalStore } from '@/lib/browser/external-store'
import { fetchOk } from '@/lib/browser/fetch-json'
import { readSseJson, sseErrorMessage } from '@/lib/browser/sse'
import type {
  ExportDone,
  ExportPhase,
  ExportProgress,
} from '@/lib/deployment/export-bundle'
import { getErrorMessage } from '@/lib/errors'

/**
 * This tab's exports, kept at module level so an export outlives the dialog that started it.
 * `sessionStorage` keeps finished exports across a reload and notes running ones as interrupted.
 */

/** `interrupted`: a reload or closed tab stopped it; `expired`: the zip is gone from the server. */
export type ExportRunPhase =
  'running' | 'done' | 'failed' | 'cancelled' | 'interrupted' | 'expired'

export interface ExportRun {
  /** The selection, as `exportKey` names it. */
  key: string
  sampleIds: string[]
  serviceIds: string[]
  includeOptional: boolean
  /** What it exports, for notices shown outside the dialog. */
  title: string
  phase: ExportRunPhase
  /** The latest line of output, while running. */
  progress: ExportProgress | null
  /** Cancel export was pressed and the stream is closing. */
  cancelling: boolean
  /** Once done: where the zip downloads, and until when. */
  download: Pick<ExportDone, 'url' | 'fileName' | 'expiresAt'> | null
  error: string | null
}

export interface ExportSelection {
  sampleIds: string[]
  serviceIds: string[]
  includeOptional: boolean
  title: string
}

const EXPORT_PHASES: readonly string[] = [
  'starting',
  'planning',
  'copying',
  'codegen',
] satisfies readonly ExportPhase[]

const STORAGE_KEY = 'export-bundle-runs'

/** The key of a selection: the same samples and services, in any order. */
export function exportKey(sampleIds: string[], serviceIds: string[]): string {
  return `samples=${[...sampleIds].sort().join(',')};services=${[...serviceIds].sort().join(',')}`
}

/** Every export of this tab, by `exportKey`; read with `useExternalStore`. */
export const exportRuns = createExternalStore<ReadonlyMap<string, ExportRun>>(
  new Map(),
)
const runs = exportRuns
/** The open event stream of each running export. */
const controllers = new Map<string, AbortController>()
/** Dialogs showing each export, with what each wants to hear when it ends. */
const viewers = new Map<string, Set<ExportViewer>>()

export interface ExportViewer {
  /** The export finished and its download started. */
  onDone?: () => void
}

function patchRun(key: string, patch: Partial<ExportRun>) {
  runs.set((prev) => {
    const run = prev.get(key)
    if (!run) return prev
    const next = new Map(prev)
    next.set(key, { ...run, ...patch })
    return next
  })
  persist()
}

function isProgress(data: unknown): data is ExportProgress {
  return (
    typeof data === 'object' &&
    data !== null &&
    'phase' in data &&
    typeof data.phase === 'string' &&
    EXPORT_PHASES.includes(data.phase) &&
    'message' in data &&
    typeof data.message === 'string'
  )
}

function isDone(data: unknown): data is ExportDone {
  return (
    typeof data === 'object' &&
    data !== null &&
    'url' in data &&
    typeof data.url === 'string' &&
    'fileName' in data &&
    typeof data.fileName === 'string'
  )
}

/** Runs the export, reporting progress; resolves with its zip's address. */
async function streamExport(
  selection: ExportSelection,
  signal: AbortSignal,
  onProgress: (progress: ExportProgress) => void,
): Promise<ExportDone> {
  const res = await fetchOk('/api/export-bundle', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      samples: selection.sampleIds,
      services: selection.serviceIds,
      includeOptional: selection.includeOptional,
    }),
    signal,
    errorMessage: 'Export failed',
  })
  if (!res.body) throw new Error('Export failed')
  for await (const { event, data } of readSseJson<unknown>(res.body)) {
    if (event === 'progress') {
      if (isProgress(data)) onProgress(data)
    } else if (event === 'error') {
      throw new Error(sseErrorMessage(data, 'Export failed'))
    } else if (event === 'done') {
      if (!isDone(data)) {
        throw new Error('The export finished without a download address')
      }
      return data
    }
  }
  throw new Error('The export stopped before it finished')
}

/** `14:32`, for "available until". */
export function formatExpiry(expiresAt: number): string {
  return new Date(expiresAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

const toastId = (key: string) => `export:${key}`

/**
 * Builds the selection's bundle; its download starts once it is ready, open
 * dialog or not. Ignored while the same selection is still building.
 */
export function startExport(selection: ExportSelection): void {
  const key = exportKey(selection.sampleIds, selection.serviceIds)
  if (runs.get().get(key)?.phase === 'running') return
  const controller = new AbortController()
  controllers.set(key, controller)
  runs.set((prev) =>
    new Map(prev).set(key, {
      key,
      sampleIds: [...selection.sampleIds],
      serviceIds: [...selection.serviceIds],
      includeOptional: selection.includeOptional,
      title: selection.title,
      phase: 'running',
      progress: null,
      cancelling: false,
      download: null,
      error: null,
    }),
  )
  persist()
  syncUnloadPrompt()

  streamExport(selection, controller.signal, (progress) =>
    patchRun(key, { progress }),
  ).then(
    (done) => {
      controllers.delete(key)
      const download = {
        url: done.url,
        fileName: done.fileName,
        expiresAt: Number(done.expiresAt) || Date.now(),
      }
      patchRun(key, { phase: 'done', download, progress: null })
      syncUnloadPrompt()
      // The browser takes it from here; nothing confirms the save finished.
      downloadUrl(download.url, download.fileName)
      toast.success('Export ready: download started', {
        id: toastId(key),
        description: `${download.fileName}. Not in your downloads? Download it again until ${formatExpiry(download.expiresAt)}.`,
        duration: 10_000,
        action: {
          label: 'Download again',
          onClick: () => void downloadExport(key),
        },
      })
      for (const viewer of viewers.get(key) ?? []) viewer.onDone?.()
    },
    (error: unknown) => {
      controllers.delete(key)
      const cancelled = controller.signal.aborted
      patchRun(key, {
        phase: cancelled ? 'cancelled' : 'failed',
        error: cancelled ? null : getErrorMessage(error, 'Export failed'),
        progress: null,
        cancelling: false,
      })
      syncUnloadPrompt()
      // Sonner merges a toast into the one with the same id, so every field
      // the background notice set is given anew.
      if (viewers.get(key)?.size) {
        toast.dismiss(toastId(key))
      } else if (cancelled) {
        toast('Export cancelled', {
          id: toastId(key),
          description: undefined,
          duration: 4_000,
          action: undefined,
        })
      } else {
        toast.error('Export failed', {
          id: toastId(key),
          description: getErrorMessage(error, 'Export failed'),
          duration: 10_000,
          action: undefined,
        })
      }
    },
  )
}

/** Closing the event stream tells the server to stop and remove what it built so far. */
export function cancelExport(key: string): void {
  const controller = controllers.get(key)
  if (!controller) return
  patchRun(key, { cancelling: true })
  controller.abort()
}

/** Downloads a finished export again, or marks it `expired` if the server no longer has it. */
export async function downloadExport(key: string): Promise<void> {
  const download = runs.get().get(key)?.download
  if (!download) return
  try {
    await fetchOk(download.url, { method: 'HEAD' })
  } catch {
    patchRun(key, { phase: 'expired' })
    return
  }
  downloadUrl(download.url, download.fileName)
}

/**
 * Registers an open dialog for `key` until the returned function is called. While none is open, a
 * running export shows a toast with Cancel export, so it can be stopped from anywhere.
 */
export function watchExport(key: string, viewer: ExportViewer): () => void {
  let set = viewers.get(key)
  if (!set) {
    set = new Set()
    viewers.set(key, set)
  }
  set.add(viewer)
  toast.dismiss(toastId(key))
  return () => {
    set.delete(viewer)
    if (set.size > 0) return
    viewers.delete(key)
    const run = runs.get().get(key)
    if (run?.phase !== 'running' || run.cancelling) return
    toast.loading('Export continues in the background', {
      id: toastId(key),
      description: `${run.title} downloads when ready; reopen Export to follow it.`,
      duration: Infinity,
      action: { label: 'Cancel export', onClick: () => cancelExport(key) },
    })
  }
}

/** Asks before a reload or a closed tab stops a running export. */
function onBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault()
  // Older browsers need returnValue set to show the prompt.
  event.returnValue = ''
}

function syncUnloadPrompt() {
  if (typeof window === 'undefined') return
  if (controllers.size > 0) {
    window.addEventListener('beforeunload', onBeforeUnload)
  } else {
    window.removeEventListener('beforeunload', onBeforeUnload)
  }
}

type StoredRun = Omit<ExportRun, 'progress' | 'cancelling'>

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

/** What was last written, to skip writes for progress lines. */
let persisted = ''

/** Keeps the finished exports, and notes the running ones, for a reload. */
function persist() {
  const kept: StoredRun[] = []
  for (const run of runs.get().values()) {
    if (run.phase !== 'running' && run.phase !== 'done') continue
    const { progress: _progress, cancelling: _cancelling, ...rest } = run
    kept.push(rest)
  }
  const json = JSON.stringify(kept)
  if (json === persisted) return
  persisted = json
  try {
    const store = storage()
    if (kept.length === 0) store?.removeItem(STORAGE_KEY)
    else store?.setItem(STORAGE_KEY, json)
  } catch {
    // Full or disabled: exports are kept for this page's life only.
  }
}

/**
 * Restores unexpired finished exports, and running ones as `interrupted`: the reload closed their
 * stream, which stopped them on the server.
 */
function restore() {
  let stored: StoredRun[] = []
  try {
    const raw = storage()?.getItem(STORAGE_KEY)
    stored = raw ? (JSON.parse(raw) as StoredRun[]) : []
  } catch {
    stored = []
  }
  if (!Array.isArray(stored) || stored.length === 0) return
  const next = new Map(runs.get())
  for (const run of stored) {
    if (typeof run?.key !== 'string' || next.has(run.key)) continue
    if (run.phase === 'running') {
      next.set(run.key, {
        ...run,
        phase: 'interrupted',
        progress: null,
        cancelling: false,
      })
    } else if (
      run.phase === 'done' &&
      run.download &&
      run.download.expiresAt > Date.now()
    ) {
      next.set(run.key, { ...run, progress: null, cancelling: false })
    }
  }
  runs.set(next)
  // The interrupted ones have been reported: keep only finished ones.
  persist()
}

// Once per page load, before anything reads the store.
if (typeof window !== 'undefined') restore()

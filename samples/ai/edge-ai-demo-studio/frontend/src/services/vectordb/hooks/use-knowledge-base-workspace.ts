// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useRef, useState } from 'react'
import { getErrorMessage } from '@/lib/errors'
import type { EmbedRunProgress, KnowledgeBase } from '../types'
import {
  useCreateFileEmbeddings,
  useCreateKb,
  useDeleteKb,
  useKbChunks,
  useKbFiles,
  useKnowledgeBases,
} from './index'

type EmbedRun = EmbedRunProgress & { running: boolean }
const IDLE_RUN: EmbedRun = { running: false, done: 0, total: 0 }

interface UseKnowledgeBaseWorkspaceOptions {
  /** This vectordb instance's address, e.g. `/api/vectordb@vector-db`. */
  apiBase: string | undefined
  selectedKb: KnowledgeBase | null
  onSelectKb: (kb: KnowledgeBase | null) => void
  /** Select a newly-created KB instead of leaving the selection as-is. */
  autoSelectCreated?: boolean
  /** Called with a knowledge base once it is created (after it is selected). */
  onCreated?: (kb: KnowledgeBase) => void
  /** Called after the selection is cleared because the selected KB was deleted. */
  onSelectedKbDeleted?: () => void
}

/**
 * Knowledge-base workspace: list/create/delete KBs and embed pending files one at a time, with
 * per-file, per-stage progress. Switching KB or unmounting stops the run, so nothing it reports
 * lands on another knowledge base.
 */
export function useKnowledgeBaseWorkspace({
  apiBase,
  selectedKb,
  onSelectKb,
  autoSelectCreated = false,
  onCreated,
  onSelectedKbDeleted,
}: UseKnowledgeBaseWorkspaceOptions) {
  const [kbName, setKbName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [embedRun, setEmbedRun] = useState<EmbedRun>(IDLE_RUN)

  const kbsQuery = useKnowledgeBases(apiBase)
  const createKbMutation = useCreateKb(apiBase)
  const deleteKbMutation = useDeleteKb(apiBase)
  const embedFileMutation = useCreateFileEmbeddings(apiBase)
  const chunksQuery = useKbChunks(apiBase, selectedKb?.id)
  const filesQuery = useKbFiles(apiBase, selectedKb?.id)
  const runRef = useRef<AbortController | null>(null)

  const stopRun = () => {
    runRef.current?.abort()
    runRef.current = null
  }

  useEffect(() => () => runRef.current?.abort(), [])

  // Embed progress is per KB: stop and reset the run when the selection changes.
  const selectKb = (kb: KnowledgeBase | null) => {
    if (kb?.id !== selectedKb?.id) {
      stopRun()
      setEmbedRun(IDLE_RUN)
    }
    onSelectKb(kb)
  }

  const createKb = () => {
    if (!kbName.trim()) return
    setError(null)
    createKbMutation.mutate(kbName.trim(), {
      onSuccess: (kb) => {
        setKbName('')
        if (autoSelectCreated) selectKb(kb)
        onCreated?.(kb)
      },
      onError: (err) => setError(getErrorMessage(err, 'Failed to create KB')),
    })
  }

  /** Deletes a knowledge base; rejects with the reason (for its confirm dialog). */
  const deleteKb = async (id: number) => {
    await deleteKbMutation.mutateAsync(id)
    if (selectedKb?.id === id) {
      selectKb(null)
      onSelectedKbDeleted?.()
    }
  }

  // `beforeRun` points the worker at its Embeddings instance first.
  const runEmbeddings = async (
    filenames: string[],
    options?: { beforeRun?: () => Promise<void> },
  ) => {
    if (!selectedKb || filenames.length === 0) return
    stopRun()
    const run = new AbortController()
    runRef.current = run
    const { signal } = run
    const kbId = selectedKb.id
    setError(null)
    setEmbedRun({ running: true, done: 0, total: filenames.length })

    if (options?.beforeRun) {
      try {
        await options.beforeRun()
      } catch (err) {
        if (signal.aborted) return
        runRef.current = null
        setError(
          getErrorMessage(err, 'Failed to configure the embedding service'),
        )
        setEmbedRun(IDLE_RUN)
        return
      }
    }

    for (const filename of filenames) {
      if (signal.aborted) return
      setEmbedRun((r) => ({ ...r, file: filename, current: undefined }))
      try {
        await embedFileMutation.mutateAsync({
          kbId,
          filename,
          signal,
          onProgress: (current) => {
            if (!signal.aborted) setEmbedRun((r) => ({ ...r, current }))
          },
        })
        if (!signal.aborted) setEmbedRun((r) => ({ ...r, done: r.done + 1 }))
      } catch (err) {
        if (!signal.aborted) {
          setError(getErrorMessage(err, `Failed to embed ${filename}`))
        }
      }
    }
    if (signal.aborted) return
    runRef.current = null
    setEmbedRun(IDLE_RUN)
    chunksQuery.refetch()
  }

  const { running, ...embedProgress } = embedRun

  return {
    knowledgeBases: kbsQuery.data ?? [],
    kbsQuery,
    kbName,
    setKbName,
    createKb,
    isCreatingKb: createKbMutation.isPending,
    deleteKb,
    selectKb,
    isEmbedding: running,
    /** The in-flight embed run, or `undefined` when none is running. */
    embedProgress: running ? embedProgress : undefined,
    runEmbeddings,
    error,
    setError,
    chunksQuery,
    filesQuery,
  }
}

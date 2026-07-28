// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useState } from 'react'
import { useGetService, useGetServices } from '@/context/service-status-context'
import type { Service } from '@/services/types'
import { engines } from '@/engines/registry'
import { ActiveKbBar } from './components/active-kb-bar'
import { AddChunkPanel } from './components/add-chunk-panel'
import { ChunksPanel } from './components/chunks-panel'
import { FileUploadPanel } from './components/file-upload-panel'
import { KnowledgeBasesRail } from './components/knowledge-bases-rail'
import { SearchPanel } from './components/search-panel'
import {
  useAddChunk,
  useConfigureEmbedding,
  useCreateFileEmbeddings,
  useCreateKb,
  useDeleteChunk,
  useDeleteKb,
  useKbChunks,
  useKbFiles,
  useKnowledgeBases,
  useSearchKb,
} from './hooks'
import type { KnowledgeBase } from './types'

type EmbedRun = { running: boolean; done: number; total: number }
const IDLE_RUN: EmbedRun = { running: false, done: 0, total: 0 }

// ── Demo component ───────────────────────────────────────────────

export function VectorDbDemo(_props: { service: Service }) {
  const embeddingsService = useGetService('embeddings')
  const { rerank: rerankService } = useGetServices(['rerank'])

  const [configured, setConfigured] = useState(false)
  const [kbName, setKbName] = useState('')
  const [selectedKb, setSelectedKb] = useState<KnowledgeBase | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { mutate: configureWorker } = useConfigureEmbedding()
  const kbsQuery = useKnowledgeBases()
  const createKbMutation = useCreateKb()
  const deleteKbMutation = useDeleteKb()
  const addChunkMutation = useAddChunk()
  const deleteChunkMutation = useDeleteChunk()
  const searchMutation = useSearchKb()
  const kbChunksQuery = useKbChunks(selectedKb?.id)
  const kbFilesQuery = useKbFiles(selectedKb?.id)
  const embedFileMutation = useCreateFileEmbeddings()
  const [embedRun, setEmbedRun] = useState<EmbedRun>(IDLE_RUN)

  // Embed progress is per-KB; reset it whenever the selected KB changes so a
  // previous KB's run state never leaks onto another.
  const selectKb = (kb: KnowledgeBase | null) => {
    setSelectedKb(kb)
    setEmbedRun(IDLE_RUN)
  }

  const embeddingPort = embeddingsService?.port

  const embeddingEngine = embeddingsService?.engine ?? 'multiserve'
  const embeddingModelConfig = {
    name:
      embeddingsService?.currentModel ??
      embeddingsService?.defaultModel?.name ??
      '',
    device:
      embeddingsService?.currentDevice ??
      embeddingsService?.defaultModel?.device ??
      '',
    backend:
      embeddingsService?.currentBackend ??
      embeddingsService?.defaultModel?.backend,
    quant: embeddingsService?.defaultModel?.quant,
  }
  const embeddingModelName = engines[embeddingEngine].getModelName(
    embeddingModelConfig,
    true,
  )
  const embeddingStatus = embeddingsService?.status
  const embeddingsOnline = embeddingStatus === 'online'

  // Resolve reranker model name when online
  const rerankOnline = rerankService?.status === 'online'
  const rerankPort = rerankService?.port
  const rerankEngine = rerankService?.engine ?? 'multiserve'
  const rerankModelConfig = {
    name:
      rerankService?.currentModel ?? rerankService?.defaultModel?.name ?? '',
    device:
      rerankService?.currentDevice ?? rerankService?.defaultModel?.device ?? '',
    backend:
      rerankService?.currentBackend ?? rerankService?.defaultModel?.backend,
    quant: rerankService?.defaultModel?.quant,
  }
  const rerankModelName =
    rerankOnline && rerankPort
      ? engines[rerankEngine].getModelName(rerankModelConfig, true)
      : undefined

  // Auto-configure the vectordb worker with the embeddings + reranker service URLs
  useEffect(() => {
    if (configured) return
    if (embeddingStatus !== 'online' || !embeddingPort || !embeddingModelName)
      return

    configureWorker(
      {
        embeddingUrl: `http://localhost:${embeddingPort}/v1`,
        embeddingModel: embeddingModelName,
        rerankerUrl:
          rerankOnline && rerankPort
            ? `http://localhost:${rerankPort}/v1`
            : undefined,
        rerankerModel: rerankModelName,
      },
      {
        onSuccess: () => setConfigured(true),
        onError: (err) =>
          setError(
            `Failed to configure embedding service: ${err instanceof Error ? err.message : String(err)}`,
          ),
      },
    )
  }, [
    embeddingStatus,
    embeddingPort,
    embeddingModelName,
    rerankOnline,
    rerankPort,
    rerankModelName,
    configured,
    configureWorker,
  ])

  const handleCreateKb = () => {
    if (!kbName.trim()) return
    setError(null)
    createKbMutation.mutate(kbName.trim(), {
      onSuccess: () => setKbName(''),
      onError: (err) =>
        setError(err instanceof Error ? err.message : 'Failed to create KB'),
    })
  }

  const handleDeleteKb = (id: number) => {
    setError(null)
    deleteKbMutation.mutate(id, {
      onSuccess: () => {
        if (selectedKb?.id === id) {
          selectKb(null)
          searchMutation.reset()
        }
      },
      onError: (err) =>
        setError(err instanceof Error ? err.message : 'Failed to delete KB'),
    })
  }

  const handleDeleteChunk = (docId: string) => {
    if (!selectedKb) return
    setError(null)
    deleteChunkMutation.mutate(
      { kbId: selectedKb.id, docId },
      {
        onError: (err) =>
          setError(
            err instanceof Error ? err.message : 'Failed to delete chunk',
          ),
      },
    )
  }

  // Replace a chunk by delete + add since worker has no update endpoint
  const handleReplaceChunk = (docId: string, content: string) => {
    if (!selectedKb) return
    setError(null)
    deleteChunkMutation.mutate(
      { kbId: selectedKb.id, docId },
      {
        onSuccess: () => {
          addChunkMutation.mutate(
            { kbId: selectedKb.id, content },
            {
              onError: (err) =>
                setError(
                  err instanceof Error
                    ? err.message
                    : 'Failed to update chunk (add step)',
                ),
            },
          )
        },
        onError: (err) =>
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to update chunk (delete step)',
          ),
      },
    )
  }

  const handleAddChunk = (content: string) => {
    if (!selectedKb) return
    setError(null)
    addChunkMutation.mutate(
      { kbId: selectedKb.id, content },
      {
        onError: (err) =>
          setError(err instanceof Error ? err.message : 'Failed to add chunk'),
      },
    )
  }

  // Embed only the files that aren't in the vector store yet, one at a time, so
  // re-running after adding a file never re-embeds (and duplicates) old files.
  const handleGenerateEmbeddings = async (filenames: string[]) => {
    if (!selectedKb || filenames.length === 0) return
    setError(null)
    setEmbedRun({ running: true, done: 0, total: filenames.length })
    for (const filename of filenames) {
      try {
        await embedFileMutation.mutateAsync({ kbId: selectedKb.id, filename })
        setEmbedRun((r) => ({ ...r, done: r.done + 1 }))
      } catch (err) {
        setError(
          err instanceof Error ? err.message : `Failed to embed ${filename}`,
        )
      }
    }
    setEmbedRun(IDLE_RUN)
    kbChunksQuery.refetch()
  }

  const handleSearch = () => {
    if (!selectedKb || !searchQuery.trim()) return
    setError(null)
    searchMutation.mutate(
      { kbId: selectedKb.id, query: searchQuery.trim() },
      {
        onError: (err) =>
          setError(err instanceof Error ? err.message : 'Search failed'),
      },
    )
  }

  const knowledgeBases = kbsQuery.data ?? []
  const chunks = kbChunksQuery.data?.chunks ?? []
  const totalChunks = kbChunksQuery.data?.total_chunks ?? 0
  const documentCount = kbFilesQuery.data?.length ?? 0

  return (
    <div className="flex flex-col gap-5 lg:flex-row">
      <div className="lg:sticky lg:top-4 lg:w-[300px] lg:shrink-0 lg:self-start">
        <KnowledgeBasesRail
          knowledgeBases={knowledgeBases}
          selectedKb={selectedKb}
          kbName={kbName}
          onKbNameChange={setKbName}
          onCreate={handleCreateKb}
          isCreating={createKbMutation.isPending}
          onRefresh={() => kbsQuery.refetch()}
          isFetching={kbsQuery.isFetching}
          isLoading={kbsQuery.isLoading}
          onSelect={selectKb}
          onDelete={handleDeleteKb}
        />
      </div>

      <div className="min-w-0 flex-1 space-y-5">
        {!embeddingsOnline && (
          <div className="border-warning/50 bg-warning/10 text-warning rounded-lg border p-3 text-sm">
            The Embeddings service is offline. Start it to enable adding chunks
            and searching by text.
          </div>
        )}

        {error && (
          <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm">
            {error}
          </div>
        )}

        <ActiveKbBar
          selectedKb={selectedKb}
          chunkCount={totalChunks}
          documentCount={documentCount}
        />

        {selectedKb ? (
          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
            <div className="space-y-5">
              <FileUploadPanel
                kbId={selectedKb.id}
                embeddingsOnline={embeddingsOnline}
                onGenerateEmbeddings={handleGenerateEmbeddings}
                isEmbedding={embedRun.running}
                embedProgress={
                  embedRun.running
                    ? { done: embedRun.done, total: embedRun.total }
                    : undefined
                }
                onError={setError}
              />

              <AddChunkPanel
                canMutate={embeddingsOnline}
                isAdding={addChunkMutation.isPending}
                onAddChunk={handleAddChunk}
              />
            </div>

            <div className="space-y-5">
              <SearchPanel
                query={searchQuery}
                onQueryChange={setSearchQuery}
                onSearch={handleSearch}
                isSearching={searchMutation.isPending}
                disabled={!embeddingsOnline}
                results={searchMutation.data}
              />

              <ChunksPanel
                chunks={chunks}
                totalChunks={totalChunks}
                isLoading={kbChunksQuery.isLoading}
                isFetching={kbChunksQuery.isFetching}
                canMutate={embeddingsOnline}
                isAdding={addChunkMutation.isPending}
                isDeleting={deleteChunkMutation.isPending}
                onRefresh={() => kbChunksQuery.refetch()}
                onDeleteChunk={handleDeleteChunk}
                onReplaceChunk={handleReplaceChunk}
              />
            </div>
          </div>
        ) : (
          <div className="text-muted-foreground border-border flex items-center justify-center rounded-xl border border-dashed p-10 text-sm">
            Select or create a knowledge base to get started.
          </div>
        )}
      </div>
    </div>
  )
}

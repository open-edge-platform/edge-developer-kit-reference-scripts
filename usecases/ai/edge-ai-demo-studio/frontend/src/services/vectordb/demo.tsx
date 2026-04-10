// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Database, FolderPlus, Loader2, Search, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useGetService, useGetServices } from '@/context/service-status-context'
import { cn } from '@/lib/utils'
import type { Service } from '@/services/types'
import { ChunksPanel } from './components/chunks-panel'
import {
  useAddChunk,
  useConfigureEmbedding,
  useCreateKb,
  useDeleteChunk,
  useDeleteKb,
  useKbChunks,
  useKnowledgeBases,
  useSearchKb,
} from './hooks'
import type { KnowledgeBase } from './types'
import { engines } from '@/engines/registry'

// ── Demo component ───────────────────────────────────────────────

export function VectorDbDemo(_props: { service: Service }) {
  const embeddingsService = useGetService('embeddings')
  const { rerank: rerankService } = useGetServices(['rerank'])

  const [configured, setConfigured] = useState(false)
  const [kbName, setKbName] = useState('')
  const [selectedKb, setSelectedKb] = useState<KnowledgeBase | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  const configureMutation = useConfigureEmbedding()
  const kbsQuery = useKnowledgeBases()
  const createKbMutation = useCreateKb()
  const deleteKbMutation = useDeleteKb()
  const addChunkMutation = useAddChunk()
  const deleteChunkMutation = useDeleteChunk()
  const searchMutation = useSearchKb()
  const kbChunksQuery = useKbChunks(selectedKb?.id)

  const embeddingPort = embeddingsService?.port

  const embeddingEngine =
    embeddingsService?.engine ?? embeddingsService?.engine ?? 'multiserve'
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

    configureMutation.mutate(
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    embeddingStatus,
    embeddingPort,
    embeddingModelName,
    rerankOnline,
    rerankPort,
    rerankModelName,
    configured,
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
          setSelectedKb(null)
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

  // Worker has no dedicated update endpoint, so we replace a chunk by delete + add.
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

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <div className="min-w-0 flex-1 space-y-6">
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

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Knowledge Base Management */}
          <div className="space-y-3">
            <p className="text-foreground flex items-center gap-2 text-sm font-medium">
              <Database className="h-4 w-4" />
              Knowledge Bases
            </p>

            <div className="flex gap-2">
              <Input
                value={kbName}
                onChange={(e) => setKbName(e.target.value)}
                placeholder="New knowledge base name..."
                className="bg-muted/30"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateKb()}
              />
              <Button
                onClick={handleCreateKb}
                disabled={createKbMutation.isPending || !kbName.trim()}
                size="icon"
                className="bg-primary hover:bg-primary-light shrink-0 text-white"
              >
                {createKbMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FolderPlus className="h-4 w-4" />
                )}
              </Button>
            </div>

            <Button
              onClick={() => kbsQuery.refetch()}
              variant="outline"
              size="sm"
              className="w-full"
              disabled={kbsQuery.isFetching}
            >
              {kbsQuery.isFetching ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Refresh List
            </Button>

            <div className="max-h-[240px] space-y-1.5 overflow-auto">
              {knowledgeBases.length === 0 ? (
                <div className="text-muted-foreground py-6 text-center text-xs">
                  {kbsQuery.isLoading
                    ? 'Loading knowledge bases...'
                    : 'No knowledge bases yet. Create one above.'}
                </div>
              ) : (
                knowledgeBases.map((kb) => (
                  <div
                    role="button"
                    tabIndex={0}
                    key={kb.id}
                    className={cn(
                      'flex w-full cursor-pointer items-center justify-between rounded-lg border p-2.5 text-left text-sm transition-colors',
                      selectedKb?.id === kb.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted/30',
                    )}
                    onClick={() => setSelectedKb(kb)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSelectedKb(kb)
                      }
                    }}
                  >
                    <span className="truncate">{kb.name}</span>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">
                        ID: {kb.id}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteKb(kb.id)
                        }}
                      >
                        <Trash2 className="text-destructive h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Operations Panel */}
          <div className="space-y-4">
            {!selectedKb ? (
              <div className="text-muted-foreground border-border flex h-full items-center justify-center rounded-xl border border-dashed p-8 text-sm">
                Select a knowledge base to manage
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {selectedKb.name}
                  </Badge>
                </div>

                <ChunksPanel
                  chunks={chunks}
                  totalChunks={kbChunksQuery.data?.total_chunks ?? 0}
                  isLoading={kbChunksQuery.isLoading}
                  isFetching={kbChunksQuery.isFetching}
                  canMutate={embeddingsOnline}
                  isAdding={addChunkMutation.isPending}
                  isDeleting={deleteChunkMutation.isPending}
                  onRefresh={() => kbChunksQuery.refetch()}
                  onAddChunk={handleAddChunk}
                  onDeleteChunk={handleDeleteChunk}
                  onReplaceChunk={handleReplaceChunk}
                />

                {/* Search */}
                <div className="space-y-2">
                  <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                    <Search className="h-3.5 w-3.5" />
                    Search Knowledge Base
                  </p>
                  <div className="flex gap-2">
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Enter search query..."
                      className="bg-muted/30 text-sm"
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    />
                    <Button
                      onClick={handleSearch}
                      disabled={
                        searchMutation.isPending ||
                        !searchQuery.trim() ||
                        !embeddingsOnline
                      }
                      size="sm"
                      className="shrink-0 gap-1.5"
                    >
                      {searchMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Search className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* Search Results */}
                {searchMutation.data && searchMutation.data.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-muted-foreground text-xs font-medium">
                      Results ({searchMutation.data.length})
                    </p>
                    <div className="max-h-[300px] space-y-2 overflow-auto">
                      {searchMutation.data.map((result, i) => (
                        <div
                          key={`result-${i}`}
                          data-testid="vectordb-search-result"
                          className="border-border bg-muted/20 space-y-1.5 rounded-lg border p-3"
                        >
                          <p className="text-foreground line-clamp-3 text-sm">
                            {result.content}
                          </p>
                          {result.score !== undefined && (
                            <div className="flex items-center gap-2">
                              <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
                                <div
                                  className="bg-primary h-full rounded-full"
                                  style={{
                                    width: `${Math.min(result.score * 100, 100)}%`,
                                  }}
                                />
                              </div>
                              <span className="text-muted-foreground font-mono text-[10px]">
                                {result.score.toFixed(3)}
                              </span>
                            </div>
                          )}
                          {result.metadata &&
                            Object.keys(result.metadata).length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {Object.entries(result.metadata).map(
                                  ([k, v]) => (
                                    <Badge
                                      key={k}
                                      variant="secondary"
                                      className="text-[9px]"
                                    >
                                      {k}: {String(v)}
                                    </Badge>
                                  ),
                                )}
                              </div>
                            )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
